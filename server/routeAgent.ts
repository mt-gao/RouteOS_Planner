import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AmapClient } from "./amapClient";
import { planSmartRoute } from "./intelligentPlanner";
import type { DestinationInput, PersonInput } from "./types";

type ModelConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  reasoningEffort?: "high" | "max";
};

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};

type RouteAgentInput = {
  message: string;
  appState?: any;
  routeResult?: any;
  history?: ChatMessage[];
};

type EmitEvent = (event: string, data: unknown) => void;

type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type ManifestPatch = {
  city?: string;
  destination?: { name: string; address: string; lng: number; lat: number } | null;
  people?: Array<{
    id?: string;
    name: string;
    address?: string;
    lng?: number;
    lat?: number;
    hasCar?: boolean;
    note?: string;
    assignedDriverId?: string;
    assignedDriverName?: string;
  }>;
  meetingPoints?: Array<{
    id?: string;
    name: string;
    address?: string;
    lng?: number;
    lat?: number;
    memberIds?: string[];
    memberNames?: string[];
    assignedDriverId?: string;
    assignedDriverName?: string;
  }>;
  clearMeetingPoints?: boolean;
  explanation?: string;
};

function readProjectText(relativePath: string) {
  try {
    return readFileSync(join(process.cwd(), relativePath), "utf8");
  } catch {
    return "";
  }
}

const AGENT_DOC = readProjectText("agent.md");
const ROUTE_SKILL = readProjectText(join("skills", "amap-route-agent", "SKILL.md"));

function minutes(seconds?: number) {
  return Math.round((seconds || 0) / 60);
}

function pointFromSuggestion(value: any) {
  if (!value) return null;
  const lng = Number(value.lng);
  const lat = Number(value.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

function routeInputsFromAppState(appState: any) {
  const people: PersonInput[] = (appState?.people || []).map((person: any) => {
    const point = pointFromSuggestion(person.selectedAddress) || pointFromSuggestion(person.location) || pointFromSuggestion(person);
    if (!point) throw new Error(`人员 ${person.name || person.id || "未命名"} 缺少坐标`);
    return {
      id: String(person.id || person.name),
      name: String(person.name || person.selectedAddress?.name || "未命名"),
      address: String(person.selectedAddress?.address || person.addressInput || person.address || person.name || "未填地址"),
      location: point,
      hasCar: Boolean(person.hasCar),
      note: person.note || "",
      assignedDriverId: person.assignedDriverId || undefined
    };
  });
  const destinationPoint = pointFromSuggestion(appState?.destination);
  if (!destinationPoint) throw new Error("终点缺少坐标");
  const destination: DestinationInput = {
    name: String(appState.destination.name || appState.destinationInput || "终点"),
    address: String(appState.destination.address || appState.destinationInput || appState.destination.name || "终点"),
    location: destinationPoint
  };
  return {
    city: String(appState?.city || "深圳"),
    people,
    destination
  };
}

function compactManifest(appState: any) {
  if (!appState) return null;
  return {
    city: appState.city,
    destination: appState.destination
      ? {
          name: appState.destination.name,
          address: appState.destination.address,
          lng: appState.destination.lng,
          lat: appState.destination.lat
        }
      : null,
    people: (appState.people || []).map((person: any) => ({
      id: person.id,
      name: person.name,
      addressInput: person.addressInput,
      selectedAddress: person.selectedAddress
        ? {
            name: person.selectedAddress.name,
            address: person.selectedAddress.address,
            lng: person.selectedAddress.lng,
            lat: person.selectedAddress.lat
          }
        : null,
      hasCar: person.hasCar,
      note: person.note,
      assignedDriverId: person.assignedDriverId
    })),
    meetingPoints: appState.meetingPoints
  };
}

function compactRoute(routeResult: any) {
  if (!routeResult) return null;
  return {
    source: routeResult.source,
    mode: routeResult.mode,
    best: routeResult.best
      ? {
          driverName: routeResult.best.driverName,
          orderedPassengerNames: routeResult.best.orderedPassengerNames,
          totalMin: minutes(routeResult.best.totalDurationSec),
          distanceKm: Number(((routeResult.best.totalDistanceM || 0) / 1000).toFixed(1)),
          segments: (routeResult.best.segments || []).map((segment: any) => ({
            from: segment.fromName,
            to: segment.toName,
            min: minutes(segment.durationSec),
            arrivalOffsetMin: minutes(segment.arrivalOffsetSec)
          }))
        }
      : null,
    meetingRoutes: routeResult.meetingRoutes,
    smartAnalysis: routeResult.smartAnalysis
  };
}

const tools = [
  {
    type: "function",
    function: {
      name: "amap_suggest_address",
      description: "Search AMap POI candidates for an address or place keyword. Use before adding unknown addresses to manifest.",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Address or POI keyword" },
          city: { type: "string", description: "City name, default Shenzhen" }
        },
        required: ["keyword", "city"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_manifest",
      description: "Return a manifest patch to the UI. Use this when the user asks to change people, addresses, drivers, destination, or meeting points.",
      parameters: {
        type: "object",
        properties: {
          patch: {
            type: "object",
            description: "Manifest patch. Include only fields that should change.",
            properties: {
              city: { type: "string" },
              destination: {
                anyOf: [
                  {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      address: { type: "string" },
                      lng: { type: "number" },
                      lat: { type: "number" }
                    },
                    required: ["name", "address", "lng", "lat"],
                    additionalProperties: false
                  },
                  { type: "string", description: "Use empty string to clear destination" }
                ]
              },
              people: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    address: { type: "string" },
                    lng: { type: "number" },
                    lat: { type: "number" },
                    hasCar: { type: "boolean" },
                    note: { type: "string" },
                    assignedDriverId: { type: "string" },
                    assignedDriverName: { type: "string" }
                  },
                  required: ["name"],
                  additionalProperties: false
                }
              },
              meetingPoints: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    address: { type: "string" },
                    lng: { type: "number" },
                    lat: { type: "number" },
                    memberIds: { type: "array", items: { type: "string" } },
                    memberNames: { type: "array", items: { type: "string" } },
                    assignedDriverId: { type: "string" },
                    assignedDriverName: { type: "string" }
                  },
                  required: ["name"],
                  additionalProperties: false
                }
              },
              clearMeetingPoints: { type: "boolean" },
              explanation: { type: "string" }
            },
            additionalProperties: false
          }
        },
        required: ["patch"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "amap_generate_smart_plan",
      description: "Generate an AMap-backed smart plan that ignores manual meeting points and finds a fast automatic meeting point.",
      parameters: {
        type: "object",
        properties: {
          objective: { type: "string", description: "Optimization goal, e.g. fastest all collected route" },
          ignoreManualMeetingPoints: { type: "boolean", description: "Must be true unless user explicitly says to preserve manual meeting points" }
        },
        required: ["objective", "ignoreManualMeetingPoints"],
        additionalProperties: false
      }
    }
  }
] as const;

function buildSystemPrompt() {
  return [
    AGENT_DOC,
    ROUTE_SKILL,
    "Current implementation notes:",
    "- The UI can apply `manifest_patch` events and `route_result` events.",
    "- If you call `amap_generate_smart_plan`, the UI will receive and display the route.",
    "- For deadline questions, use routeResult.smartAnalysis.selectedMeeting.members duration data when available."
  ].join("\n\n");
}

async function deepseekChat(messages: any[], config: ModelConfig, options: { stream: boolean; tools?: unknown }) {
  const baseUrl = (config.baseUrl || "https://api.deepseek.com").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model || "deepseek-v4-flash",
      messages,
      tools: options.tools,
      stream: options.stream,
      thinking: { type: "enabled" },
      reasoning_effort: config.reasoningEffort || "max"
    })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`DeepSeek 请求失败：HTTP ${response.status}${text ? ` ${text.slice(0, 160)}` : ""}`);
  }
  return response;
}

function parseToolArguments(call: ToolCall) {
  try {
    return call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return {};
  }
}

async function fallbackStream(input: RouteAgentInput, emit: EmitEvent) {
  const route = compactRoute(input.routeResult);
  const text = route?.smartAnalysis?.selectedMeeting
    ? `我先按当前高德数据回答：推荐集合点是 ${route.smartAnalysis.selectedMeeting.meetingPointName}。如果要问 9 点前全员集合，可以直接问某个人，我会按他的到集合点耗时倒推出最晚出发时间。`
    : "我需要先有一版路线或完整行程清单。你可以让我“AI生成规划”，我会调用高德数据找自动集合点。";
  for (const char of text) {
    emit("token", { content: char });
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}

async function executeTool(call: ToolCall, input: RouteAgentInput, amap: AmapClient, emit: EmitEvent) {
  const args = parseToolArguments(call);
  if (call.function.name === "amap_suggest_address") {
    emit("tool", { name: "amap_suggest_address", status: "running", label: `搜索 ${args.keyword || ""}` });
    const items = await amap.suggest(String(args.keyword || ""), String(args.city || input.appState?.city || "深圳"));
    return { candidates: items.slice(0, 5) };
  }

  if (call.function.name === "update_manifest") {
    const patch = (args.patch || {}) as ManifestPatch;
    emit("manifest_patch", { patch });
    return { appliedToUi: true, patch };
  }

  if (call.function.name === "amap_generate_smart_plan") {
    emit("tool", { name: "amap_generate_smart_plan", status: "running", label: "调用高德生成智能集合路线" });
    const routeInput = routeInputsFromAppState(input.appState);
    const result = await planSmartRoute(amap, routeInput);
    emit("route_result", { routeResult: result });
    return {
      generated: true,
      summary: result.smartAnalysis?.summary,
      selectedMeeting: result.smartAnalysis?.selectedMeeting,
      topCandidates: result.smartAnalysis?.candidates?.slice(0, 4)
    };
  }

  return { error: `Unknown tool ${call.function.name}` };
}

async function readStream(response: Response, emit: EmitEvent) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        const data = JSON.parse(raw);
        const content = data.choices?.[0]?.delta?.content || "";
        if (content) emit("token", { content });
      } catch {
        // Ignore malformed stream fragments.
      }
    }
  }
}

export async function streamRouteAgent(input: RouteAgentInput, config: ModelConfig, amap: AmapClient, emit: EmitEvent) {
  if (!config.apiKey) {
    await fallbackStream(input, emit);
    emit("done", { source: "fallback" });
    return;
  }

  const messages: any[] = [
    { role: "system", content: buildSystemPrompt() },
    ...(input.history || []).slice(-8).map((message) => ({ role: message.role, content: message.content })),
    {
      role: "user",
      content: JSON.stringify({
        userMessage: input.message,
        currentManifest: compactManifest(input.appState),
        latestRoute: compactRoute(input.routeResult)
      })
    }
  ];

  for (let round = 0; round < 4; round += 1) {
    const response = await deepseekChat(messages, config, { stream: false, tools });
    const data = (await response.json()) as { choices?: Array<{ message?: any }> };
    const message = data.choices?.[0]?.message;
    if (!message) break;
    messages.push(message);
    const toolCalls = (message.tool_calls || []) as ToolCall[];
    if (!toolCalls.length) break;

    for (const call of toolCalls) {
      const result = await executeTool(call, input, amap, emit);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }
  }

  messages.push({
    role: "user",
    content:
      "请根据以上工具结果给出用户可读的最终答复。若已生成路线，说明司机、集合点、总耗时、节省时间、每个人交通方式。若已更新清单，说明更新内容。若用户问截止时间，给出最晚出发时间和计算口径。"
  });
  const stream = await deepseekChat(messages, config, { stream: true });
  await readStream(stream, emit);
  emit("done", { source: "model" });
}
