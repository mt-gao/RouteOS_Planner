import { z } from "zod";
import { AmapClient } from "../server/amapClient";
import { replyToRouteChat } from "../server/chatAssistant";
import { planSmartRoute } from "../server/intelligentPlanner";
import { planPickupRoutes, planPickupStops } from "../server/planner";
import { createExternalRequestBudget, toChatErrorMessage, toPublicErrorMessage, type ExternalRequestBudget } from "../server/requestBudget";
import { streamRouteAgent } from "../server/routeAgent";
import { withRouteShare } from "../server/routeShare";
import type { DestinationInput, MeetingPointInput, PersonInput, PickupStopInput, TimeConstraint } from "../server/types";

type Env = {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  AMAP_KEY?: string;
  AMAP_JS_KEY?: string;
  AMAP_SECURITY_JS_CODE?: string;
  MODEL_API_KEY?: string;
  MODEL_BASE_URL?: string;
  MODEL_NAME?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_REASONING_EFFORT?: "high" | "max";
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  RUNTIME_NAME?: string;
};

const pointSchema = z.object({
  lng: z.number(),
  lat: z.number()
});

const personSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  location: pointSchema,
  hasCar: z.boolean(),
  note: z.string().optional(),
  assignedDriverId: z.string().optional()
});

const destinationSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  location: pointSchema
});

const meetingPointSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  location: pointSchema,
  memberIds: z.array(z.string()).default([]),
  assignedDriverId: z.string().optional()
});

const timeConstraintSchema = z
  .object({
    kind: z.enum(["departure", "arrival"]),
    time: z.string().regex(/^\d{1,2}:\d{2}$/),
    source: z.enum(["manual", "chat"]).optional()
  })
  .optional()
  .nullable();

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {})
    }
  });
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new Error("请求体不是有效 JSON");
  }
}

function modelConfig(env: Env, requestBudget?: ExternalRequestBudget) {
  return {
    apiKey: env.MODEL_API_KEY || env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY,
    baseUrl: env.MODEL_BASE_URL || env.DEEPSEEK_BASE_URL || env.OPENAI_BASE_URL || "https://api.deepseek.com",
    model: env.MODEL_NAME || env.DEEPSEEK_MODEL || env.OPENAI_MODEL || "deepseek-v4-flash",
    reasoningEffort: env.DEEPSEEK_REASONING_EFFORT || "max",
    requestBudget,
    maxToolRounds: 2
  };
}

function amapClient(env: Env, requestBudget?: ExternalRequestBudget) {
  if (!env.AMAP_KEY) throw new Error("AMAP_KEY is required");
  return new AmapClient(env.AMAP_KEY, env.AMAP_JS_KEY || env.AMAP_KEY, env.AMAP_SECURITY_JS_CODE, {
    requestBudget,
    maxRetries: 0
  });
}

async function routePlan(request: Request, amap: AmapClient) {
  const body = z
    .object({
      people: z.array(personSchema).min(1).max(8),
      destination: destinationSchema,
      meetingPoints: z.array(meetingPointSchema).default([]),
      timeConstraint: timeConstraintSchema,
      city: z.string().trim().default("深圳")
    })
    .parse(await readJson(request)) as {
    people: PersonInput[];
    destination: DestinationInput;
    meetingPoints: MeetingPointInput[];
    timeConstraint?: TimeConstraint | null;
    city: string;
  };

  const points = [
    ...body.people.map((person) => ({ id: person.id, name: person.name, lng: person.location.lng, lat: person.location.lat })),
    ...body.meetingPoints.map((meeting) => ({ id: meeting.id, name: meeting.name, lng: meeting.location.lng, lat: meeting.location.lat })),
    { id: "dest", name: body.destination.name, lng: body.destination.location.lng, lat: body.destination.location.lat }
  ];
  const matrix = await amap.matrix(points);

  const groupedPersonIds = new Set(body.meetingPoints.flatMap((meeting) => meeting.memberIds));
  const drivers = body.people.filter((person) => person.hasCar);
  const pickupStops: PickupStopInput[] = [
    ...body.people
      .filter((person) => !person.hasCar && !groupedPersonIds.has(person.id))
      .map((person) => ({
        id: person.id,
        name: person.name,
        address: person.address,
        location: person.location,
        kind: "person" as const,
        assignedDriverId: person.assignedDriverId
      })),
    ...body.meetingPoints
      .filter((meeting) => meeting.memberIds.length > 0)
      .map((meeting) => ({
        id: meeting.id,
        name: meeting.name,
        address: meeting.address,
        location: meeting.location,
        kind: "meeting" as const,
        memberIds: meeting.memberIds,
        memberNames: meeting.memberIds
          .map((id) => body.people.find((person) => person.id === id)?.name)
          .filter(Boolean) as string[],
        assignedDriverId: meeting.assignedDriverId
      }))
  ];

  const planned =
    body.meetingPoints.length || body.people.some((person) => person.assignedDriverId)
      ? planPickupStops(drivers, pickupStops, body.destination, matrix)
      : {
          mode: "single-driver" as const,
          ...planPickupRoutes(body.people, body.destination, matrix),
          driverRoutes: [] as ReturnType<typeof planPickupRoutes>["driverCandidates"]
        };

  const stopsById = new Map(pickupStops.map((stop) => [stop.id, stop]));
  for (const person of body.people) {
    stopsById.set(person.id, {
      id: person.id,
      name: person.name,
      address: person.address,
      location: person.location,
      kind: "person",
      assignedDriverId: person.assignedDriverId
    });
  }

  const attachRouteDetail = async (plan: typeof planned.best) => {
    const driver = body.people.find((person) => person.id === plan.driverId);
    if (!driver) return plan;
    const waypoints = plan.orderedPassengerIds.map((id) => {
      const stop = stopsById.get(id);
      if (!stop) throw new Error(`无法识别点位 ${id}`);
      return stop.location;
    });
    const routeDetail = await amap.routeDetail(driver.location, waypoints, body.destination.location);
    return { ...plan, routeDetail };
  };

  const rawDriverRoutes = planned.driverRoutes.length ? planned.driverRoutes : [planned.best];
  const driverRoutes = [];
  for (const plan of rawDriverRoutes) driverRoutes.push(await attachRouteDetail(plan));
  const bestWithDetail = planned.mode === "multi-driver" ? planned.best : driverRoutes[0];

  const meetingRoutes = [];
  for (const meeting of body.meetingPoints) {
    const members = [];
    for (const personId of meeting.memberIds) {
      const person = body.people.find((candidate) => candidate.id === personId);
      if (!person) continue;
      const pairKey = `${person.id}:${meeting.id}`;
      const durationSec = matrix.durations[pairKey] || 0;
      const distanceM = matrix.distances[pairKey] || 0;
      const transit = await amap.transitDetail(person.location, meeting.location, body.city).catch(() => null);
      const transitLooksUseful = Boolean(transit?.steps.length) && transit!.durationSec <= durationSec * 1.8 + 900;
      const suggestedMode: "public_transit" | "taxi" = transitLooksUseful ? "public_transit" : "taxi";
      const suggestion =
        suggestedMode === "public_transit"
          ? `建议公共交通到集合点，约 ${Math.round((transit?.durationSec || 0) / 60)} 分钟：${transit?.steps.join("；") || "按高德公交推荐换乘"}。`
          : `建议打车或家人接送到集合点，约 ${Math.round(durationSec / 60)} 分钟、${(distanceM / 1000).toFixed(1)} 公里${
              transit ? `；公交约 ${Math.round(transit.durationSec / 60)} 分钟，时间不占优。` : "；暂无稳定公交方案。"
            }`;
      members.push({
        personId: person.id,
        personName: person.name,
        durationSec,
        distanceM,
        suggestedMode,
        suggestion,
        transit: transit || undefined
      });
    }
    meetingRoutes.push({
      meetingPointId: meeting.id,
      meetingPointName: meeting.name,
      members
    });
  }

  return withRouteShare(
    {
      generatedAt: new Date().toISOString(),
      mode: planned.mode,
      source: "manual" as const,
      best: bestWithDetail,
      alternatives: planned.alternatives,
      driverCandidates: planned.driverCandidates,
      driverRoutes,
      meetingRoutes
    },
    {
      people: body.people,
      destination: body.destination,
      meetingPoints: body.meetingPoints,
      timeConstraint: body.timeConstraint
    }
  );
}

async function smartPlan(request: Request, amap: AmapClient) {
  const body = z
    .object({
      people: z.array(personSchema).min(2).max(8),
      destination: destinationSchema,
      timeConstraint: timeConstraintSchema,
      city: z.string().trim().default("深圳")
    })
    .parse(await readJson(request)) as {
    people: PersonInput[];
    destination: DestinationInput;
    timeConstraint?: TimeConstraint | null;
    city: string;
  };

  const result = await planSmartRoute(amap, body);
  return withRouteShare(result, { people: body.people, destination: body.destination, timeConstraint: body.timeConstraint });
}

function methodNotAllowed() {
  return json({ error: "Method not allowed" }, { status: 405 });
}

async function chatStream(request: Request, env: Env, amap: AmapClient, ctx: any, requestBudget?: ExternalRequestBudget) {
  const body = z
    .object({
      message: z.string().trim().min(1),
      appState: z.unknown().optional(),
      routeResult: z.unknown().optional(),
      history: z.array(z.object({ role: z.enum(["assistant", "user"]), content: z.string() })).default([])
    })
    .parse(await readJson(request));

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const write = (event: string, data: unknown) => {
    writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  ctx.waitUntil(
    (async () => {
      try {
        await streamRouteAgent(
          { message: body.message, appState: body.appState, routeResult: body.routeResult, history: body.history },
          modelConfig(env, requestBudget),
          amap,
          write
        );
      } catch (error) {
        write("error", { error: toChatErrorMessage(error) });
      } finally {
        await writer.close();
      }
    })()
  );

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

async function handleApi(request: Request, env: Env, ctx: any) {
  const url = new URL(request.url);
  const requestBudget = createExternalRequestBudget(45);
  const amap = amapClient(env, requestBudget);

  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({
      status: "ok",
      hasAmapKey: Boolean(env.AMAP_KEY),
      hasModelKey: Boolean(modelConfig(env, requestBudget).apiKey),
      runtime: env.RUNTIME_NAME || "cloudflare-worker"
    });
  }

  if (url.pathname === "/api/city-suggest" && request.method === "GET") {
    const query = z.object({ keyword: z.string().trim().min(1) }).parse(Object.fromEntries(url.searchParams));
    return json(await amap.citySuggest(query.keyword));
  }

  if (url.pathname === "/api/amap-js" && request.method === "GET") {
    const callback = String(url.searchParams.get("callback") || "__initAmap");
    if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(callback)) {
      return new Response("Invalid callback", { status: 400 });
    }
    return new Response(await amap.loadJsApi(callback), {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=600"
      }
    });
  }

  if (url.pathname === "/api/suggest" && request.method === "GET") {
    const query = z
      .object({
        keyword: z.string().trim().min(1),
        city: z.string().trim().default("深圳")
      })
      .parse(Object.fromEntries(url.searchParams));
    return json(await amap.suggest(query.keyword, query.city));
  }

  if (url.pathname === "/api/geocode" && request.method === "GET") {
    const query = z
      .object({
        address: z.string().trim().min(1),
        city: z.string().trim().default("深圳")
      })
      .parse(Object.fromEntries(url.searchParams));
    return json(await amap.geocode(query.address, query.city));
  }

  if (url.pathname === "/api/matrix") {
    if (request.method !== "POST") return methodNotAllowed();
    const body = z.object({ points: z.array(z.object({ id: z.string(), name: z.string(), lng: z.number(), lat: z.number() })).min(2) }).parse(await readJson(request));
    return json(await amap.matrix(body.points));
  }

  if (url.pathname === "/api/route/detail") {
    if (request.method !== "POST") return methodNotAllowed();
    const body = z
      .object({
        origin: pointSchema,
        waypoints: z.array(pointSchema).default([]),
        destination: pointSchema,
        strategy: z.string().default("0")
      })
      .parse(await readJson(request));
    return json(await amap.routeDetail(body.origin, body.waypoints, body.destination, body.strategy));
  }

  if (url.pathname === "/api/route/plan") {
    if (request.method !== "POST") return methodNotAllowed();
    return json(await routePlan(request, amap));
  }

  if (url.pathname === "/api/route/smart-plan") {
    if (request.method !== "POST") return methodNotAllowed();
    return json(await smartPlan(request, amap));
  }

  if (url.pathname === "/api/route/chat") {
    if (request.method !== "POST") return methodNotAllowed();
    const body = z
      .object({
        message: z.string().trim().min(1),
        routeResult: z.unknown().optional()
      })
      .parse(await readJson(request));
    return json(await replyToRouteChat({ message: body.message, routeResult: body.routeResult }, modelConfig(env, requestBudget)));
  }

  if (url.pathname === "/api/route/chat-stream") {
    if (request.method !== "POST") return methodNotAllowed();
    return chatStream(request, env, amap, ctx, requestBudget);
  }

  return json({ error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, ctx: any) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, ctx);
      } catch (error) {
        const message = toPublicErrorMessage(error);
        return json({ error: message }, { status: 400 });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
