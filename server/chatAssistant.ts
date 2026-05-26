import { REQUEST_OVERLOAD_MESSAGE } from "./requestBudget.js";

type ModelConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

type ChatInput = {
  message: string;
  routeResult?: any;
};

function minutes(seconds?: number) {
  return Math.round((seconds || 0) / 60);
}

function compactRouteContext(routeResult: any) {
  if (!routeResult) return null;
  return {
    source: routeResult.source || "manual",
    mode: routeResult.mode,
    best: routeResult.best
      ? {
          driverName: routeResult.best.driverName,
          orderedPassengerNames: routeResult.best.orderedPassengerNames,
          totalDurationMin: minutes(routeResult.best.totalDurationSec),
          totalDistanceKm: Number(((routeResult.best.totalDistanceM || 0) / 1000).toFixed(1)),
          detourMin: minutes(routeResult.best.detourDurationSec),
          segments: (routeResult.best.segments || []).map((segment: any) => ({
            from: segment.fromName,
            to: segment.toName,
            min: minutes(segment.durationSec),
            km: Number(((segment.distanceM || 0) / 1000).toFixed(1))
          }))
        }
      : null,
    meetingRoutes: routeResult.meetingRoutes,
    smartAnalysis: routeResult.smartAnalysis
      ? {
          summary: routeResult.smartAnalysis.summary,
          baselineMin: minutes(routeResult.smartAnalysis.baselineTotalDurationSec),
          selectedMeeting: routeResult.smartAnalysis.selectedMeeting
            ? {
                name: routeResult.smartAnalysis.selectedMeeting.meetingPointName,
                driverName: routeResult.smartAnalysis.selectedMeeting.driverName,
                totalMin: minutes(routeResult.smartAnalysis.selectedMeeting.totalDurationSec),
                savedMin: minutes(routeResult.smartAnalysis.selectedMeeting.savedVsBaselineSec),
                members: routeResult.smartAnalysis.selectedMeeting.members?.map((member: any) => ({
                  name: member.personName,
                  mode: member.suggestedMode,
                  min: minutes(member.durationSec),
                  suggestion: member.suggestion
                }))
              }
            : null,
          candidates: (routeResult.smartAnalysis.candidates || []).map((candidate: any) => ({
            name: candidate.meetingPointName,
            totalMin: minutes(candidate.totalDurationSec),
            savedMin: minutes(candidate.savedVsBaselineSec),
            reason: candidate.reason
          })),
          caveats: routeResult.smartAnalysis.caveats
        }
      : null
  };
}

function fallbackReply(input: ChatInput) {
  const context = compactRouteContext(input.routeResult);
  if (!context?.best) {
    return "先生成一版路线，我就能根据耗时、接人顺序和集合点候选帮你微调。";
  }

  const message = input.message.toLowerCase();
  const smart = context.smartAnalysis;
  if (message.includes("集合") || message.includes("ai") || message.includes("智能")) {
    if (smart?.selectedMeeting) {
      return `${smart.summary} 候选里排第一的是 ${smart.selectedMeeting.name}，总耗时约 ${smart.selectedMeeting.totalMin} 分钟，相比逐个接人约节省 ${smart.selectedMeeting.savedMin} 分钟。`;
    }
    return "当前方案没有智能集合点结果。可以点左侧“AI 智能路线”，让我先用高德数据自动筛候选集合点。";
  }

  if (message.includes("公交") || message.includes("地铁") || message.includes("打车")) {
    const members = smart?.selectedMeeting?.members || [];
    if (members.length) {
      return members.map((member: any) => `${member.name}：${member.suggestion}`).join("\n");
    }
    return "当前路线没有集合成员的公共交通建议。手动集合点或 AI 智能路线生成后，这里会显示每个人建议坐公交还是打车。";
  }

  if (message.includes("快") || message.includes("时间") || message.includes("多久")) {
    return `当前推荐总耗时约 ${context.best.totalDurationMin} 分钟，距离约 ${context.best.totalDistanceKm} 公里。${
      smart?.selectedMeeting ? `智能集合点方案相对逐个接人约节省 ${smart.selectedMeeting.savedMin} 分钟。` : `多绕路约 ${context.best.detourMin} 分钟。`
    }`;
  }

  if (message.includes("司机") || message.includes("谁接")) {
    return `当前推荐由 ${context.best.driverName} 执行，顺序是：${context.best.orderedPassengerNames?.join(" -> ") || "直接去终点"}。`;
  }

  return `我先按当前高德路线数据回答：推荐由 ${context.best.driverName} 执行，总耗时约 ${context.best.totalDurationMin} 分钟。你可以继续问“能不能更快”、“谁坐地铁”、“换集合点会怎样”。`;
}

async function modelReply(input: ChatInput, config: ModelConfig) {
  const baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model || "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "你是路线调度助手。只根据给定高德路线数据回答，优先说明耗时、集合点、司机接人顺序、公共交通和打车建议。不要编造不存在的地点或时间。"
        },
        {
          role: "user",
          content: JSON.stringify({
            routeContext: compactRouteContext(input.routeResult),
            userMessage: input.message
          })
        }
      ]
    })
  });
  if (!response.ok) throw new Error(`模型请求失败：HTTP ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() || "模型没有返回可用回复。";
}

export async function replyToRouteChat(input: ChatInput, config: ModelConfig) {
  if (config.apiKey) {
    try {
      return {
        source: "model" as const,
        reply: await modelReply(input, config)
      };
    } catch (error) {
      return {
        source: "fallback" as const,
        reply: `${fallbackReply(input)}\n\n${REQUEST_OVERLOAD_MESSAGE}`
      };
    }
  }

  return {
    source: "fallback" as const,
    reply: `${fallbackReply(input)}\n\n当前未配置 MODEL_API_KEY 或 OPENAI_API_KEY，所以这里先用本地规则解释高德数据。`
  };
}
