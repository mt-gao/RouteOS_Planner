import express from "express";
import { z } from "zod";
import { AmapClient } from "./amapClient.js";
import { replyToRouteChat } from "./chatAssistant.js";
import { env } from "./env.js";
import { planSmartRoute } from "./intelligentPlanner.js";
import { planPickupRoutes, planPickupStops } from "./planner.js";
import { toChatErrorMessage, toPublicErrorMessage } from "./requestBudget.js";
import { streamRouteAgent } from "./routeAgent.js";
import { withRouteShare } from "./routeShare.js";
import type { DestinationInput, MeetingPointInput, PersonInput, PickupStopInput, TimeConstraint } from "./types.js";

const app = express();
const amap = new AmapClient(env.AMAP_KEY, env.AMAP_JS_KEY || env.AMAP_KEY, env.AMAP_SECURITY_JS_CODE, { maxRetries: 1 });

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

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", hasAmapKey: Boolean(env.AMAP_KEY), hasModelKey: Boolean(env.MODEL_API_KEY) });
});

app.get("/api/amap-js", async (req, res, next) => {
  try {
    const callback = String(req.query.callback || "__initAmap");
    if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(callback)) {
      res.status(400).send("Invalid callback");
      return;
    }
    const script = await amap.loadJsApi(callback);
    res.type("application/javascript").send(script);
  } catch (error) {
    next(error);
  }
});

app.get("/api/suggest", async (req, res, next) => {
  try {
    const query = z
      .object({
        keyword: z.string().trim().min(1),
        city: z.string().trim().default("深圳")
      })
      .parse(req.query);
    const suggestions = await amap.suggest(query.keyword, query.city);
    res.json(suggestions);
  } catch (error) {
    next(error);
  }
});

app.get("/api/city-suggest", async (req, res, next) => {
  try {
    const query = z.object({ keyword: z.string().trim().min(1) }).parse(req.query);
    const cities = await amap.citySuggest(query.keyword);
    res.json(cities);
  } catch (error) {
    next(error);
  }
});

app.get("/api/geocode", async (req, res, next) => {
  try {
    const query = z
      .object({
        address: z.string().trim().min(1),
        city: z.string().trim().default("深圳")
      })
      .parse(req.query);
    const locations = await amap.geocode(query.address, query.city);
    res.json(locations);
  } catch (error) {
    next(error);
  }
});

app.post("/api/matrix", async (req, res, next) => {
  try {
    const body = z.object({ points: z.array(z.object({ id: z.string(), name: z.string(), lng: z.number(), lat: z.number() })).min(2) }).parse(req.body);
    const matrix = await amap.matrix(body.points);
    res.json(matrix);
  } catch (error) {
    next(error);
  }
});

app.post("/api/route/detail", async (req, res, next) => {
  try {
    const body = z
      .object({
        origin: pointSchema,
        waypoints: z.array(pointSchema).default([]),
        destination: pointSchema,
        strategy: z.string().default("0")
      })
      .parse(req.body);
    const detail = await amap.routeDetail(body.origin, body.waypoints, body.destination, body.strategy);
    res.json(detail);
  } catch (error) {
    next(error);
  }
});

app.post("/api/route/plan", async (req, res, next) => {
  try {
    const body = z
      .object({
        people: z.array(personSchema).min(1).max(8),
        destination: destinationSchema,
        meetingPoints: z.array(meetingPointSchema).default([]),
        timeConstraint: timeConstraintSchema,
        city: z.string().trim().default("深圳")
      })
      .parse(req.body) as {
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
    for (const plan of rawDriverRoutes) {
      driverRoutes.push(await attachRouteDetail(plan));
    }
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

    const routeResponse = {
      generatedAt: new Date().toISOString(),
      mode: planned.mode,
      source: "manual" as const,
      best: bestWithDetail,
      alternatives: planned.alternatives,
      driverCandidates: planned.driverCandidates,
      driverRoutes,
      meetingRoutes
    };

    res.json(
      withRouteShare(routeResponse, {
        people: body.people,
        destination: body.destination,
        meetingPoints: body.meetingPoints,
        timeConstraint: body.timeConstraint
      })
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/route/smart-plan", async (req, res, next) => {
  try {
    const body = z
      .object({
        people: z.array(personSchema).min(2).max(8),
        destination: destinationSchema,
        timeConstraint: timeConstraintSchema,
        city: z.string().trim().default("深圳")
      })
      .parse(req.body) as {
        people: PersonInput[];
        destination: DestinationInput;
        timeConstraint?: TimeConstraint | null;
        city: string;
      };

    const result = await planSmartRoute(amap, body);
    res.json(withRouteShare(result, { people: body.people, destination: body.destination, timeConstraint: body.timeConstraint }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/route/chat", async (req, res, next) => {
  try {
    const body = z
      .object({
        message: z.string().trim().min(1),
        routeResult: z.unknown().optional()
      })
      .parse(req.body);
    const result = await replyToRouteChat(
      { message: body.message, routeResult: body.routeResult },
      { apiKey: env.MODEL_API_KEY, baseUrl: env.MODEL_BASE_URL, model: env.MODEL_NAME }
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/route/chat-stream", async (req, res, next) => {
  try {
    const body = z
      .object({
        message: z.string().trim().min(1),
        appState: z.unknown().optional(),
        routeResult: z.unknown().optional(),
        history: z.array(z.object({ role: z.enum(["assistant", "user"]), content: z.string() })).default([])
      })
      .parse(req.body);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const emit = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    await streamRouteAgent(
      { message: body.message, appState: body.appState, routeResult: body.routeResult, history: body.history },
      {
        apiKey: env.MODEL_API_KEY,
        baseUrl: env.MODEL_BASE_URL,
        model: env.MODEL_NAME,
        reasoningEffort: env.DEEPSEEK_REASONING_EFFORT || "max"
      },
      amap,
      emit
    );
    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: toChatErrorMessage(error) })}\n\n`);
      res.end();
      return;
    }
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = toPublicErrorMessage(error);
  res.status(400).json({ error: message });
});

app.listen(env.PORT, "127.0.0.1", () => {
  console.log(`RouteOS api listening on http://127.0.0.1:${env.PORT}`);
});
