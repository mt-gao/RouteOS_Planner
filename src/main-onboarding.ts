import "./styles.css";
import "./styles-onboarding.css";
import { loadState, saveState } from "./store";
import { createOnboardingFlow } from "./ui/onboardingFlow";
import { createMapView as createAMapView } from "./ui/mapView";
import { renderRouteResult } from "./ui/routeResult";
import type { AppState, RoutePlanResponse } from "./types";

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
  streaming?: boolean;
  status?: string;
  startedAt?: number;
  elapsedSec?: number;
  steps?: string[];
};

let state = loadState();
let currentView: "result" | "map" = "result";
let mapViewInstance: ReturnType<typeof createAMapView> | null = null;

// 全局需求对话框实例和聊天记录
let requirementDialogInstance: ReturnType<typeof createRequirementDialog> | null = null;
let requirementChatMessages: ChatMessage[] = [];

async function readApiJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const message = text.includes("The page could not be found")
      ? "线上 API 路由还没有部署完成，请稍后刷新页面再试。"
      : text.trim() || `请求失败：HTTP ${response.status}`;
    throw new Error(message);
  }
}

// 解析SSE chunk
function parseSseChunk(buffer: string, onEvent: (event: string, data: any) => void): string {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() || "";
  for (const part of parts) {
    const lines = part.split(/\r?\n/);
    const eventLine = lines.find((line) => line.startsWith("event:"));
    const dataLine = lines.find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    const event = eventLine?.slice(6).trim() || "message";
    const raw = dataLine.slice(5).trim();
    try {
      onEvent(event, JSON.parse(raw));
    } catch {
      onEvent(event, raw);
    }
  }
  return rest;
}

// 格式化耗时
function formatElapsed(seconds = 0) {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// 创建需求对话框
function createRequirementDialog(config: {
  onSubmit: (message: string) => Promise<void>;
  onClose: () => void;
  initialMessages?: ChatMessage[];
  onMessagesUpdate?: (messages: ChatMessage[]) => void;
}) {
  const container = document.createElement("div");
  container.className = "requirement-dialog-overlay";

  const dialog = document.createElement("div");
  dialog.className = "requirement-dialog";

  dialog.innerHTML = `
    <div class="requirement-dialog-header">
      <h3>补充需求</h3>
      <p>AI已生成初始规划，你可以补充额外需求来优化方案</p>
      <button id="closeDialog" class="close-dialog-button">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <div class="requirement-dialog-suggestions">
      <span>推荐询问：</span>
      <button class="suggestion-chip" data-message="每个人最晚几点出发？">出发时间</button>
      <button class="suggestion-chip" data-message="集合点附近有没有地铁站？">地铁站</button>
      <button class="suggestion-chip" data-message="这个方案多绕了多远？">绕路情况</button>
    </div>
    <div class="requirement-dialog-content">
      <div id="chatMessages" class="requirement-chat-messages"></div>
    </div>
    <form id="chatForm" class="requirement-dialog-form">
      <textarea id="chatInput" class="requirement-input" rows="2" placeholder="例如：叶哥几点下楼？"></textarea>
      <button id="sendButton" class="primary-button" type="submit">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        发送
      </button>
    </form>
  `;

  container.appendChild(dialog);

  const chatMessages = dialog.querySelector<HTMLElement>("#chatMessages")!;
  const chatForm = dialog.querySelector<HTMLFormElement>("#chatForm")!;
  const chatInput = dialog.querySelector<HTMLTextAreaElement>("#chatInput")!;
  const sendButton = dialog.querySelector<HTMLButtonElement>("#sendButton")!;
  const closeButton = dialog.querySelector<HTMLButtonElement>("#closeDialog")!;
  const suggestionChips = dialog.querySelectorAll<HTMLButtonElement>(".suggestion-chip");

  let messages: ChatMessage[] = config.initialMessages ? [...config.initialMessages] : [];
  let chatTickTimer: number | null = null;

  function startChatTicker() {
    if (chatTickTimer !== null) clearInterval(chatTickTimer);
    chatTickTimer = window.setInterval(() => {
      let changed = false;
      for (const message of messages) {
        if (message.streaming && message.startedAt) {
          message.elapsedSec = Math.max(0, Math.floor((Date.now() - message.startedAt) / 1000));
          changed = true;
        }
      }
      if (changed) renderMessages();
    }, 1000);
  }

  function stopChatTicker() {
    if (chatTickTimer !== null) {
      clearInterval(chatTickTimer);
      chatTickTimer = null;
    }
  }

  function updateAssistantProgress(message: ChatMessage, status: string) {
    message.status = status;
    message.steps = [...(message.steps || []), status].slice(-4);
    message.elapsedSec = message.startedAt ? Math.max(0, Math.floor((Date.now() - message.startedAt) / 1000)) : message.elapsedSec;
    renderMessages();
  }

  function saveMessages() {
    config.onMessagesUpdate?.([...messages]);
  }

  function renderMessages() {
    const wasNearBottom = chatMessages.scrollTop + chatMessages.clientHeight >= chatMessages.scrollHeight - 40;
    chatMessages.innerHTML = "";

    for (const message of messages) {
      const bubble = document.createElement("div");
      bubble.className = `requirement-chat-message ${message.role}`;

      if (message.role === "assistant" && (message.streaming || message.status)) {
        const live = document.createElement("div");
        live.className = message.streaming ? "requirement-chat-status active" : "requirement-chat-status";
        const elapsed = message.elapsedSec ?? (message.startedAt ? Math.max(0, Math.floor((Date.now() - message.startedAt) / 1000)) : 0);
        live.innerHTML = `
          <span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <strong>${message.streaming ? "思考中" : "已完成"}</strong>
          <time>${formatElapsed(elapsed)}</time>
        `;
        bubble.append(live);

        if (message.status) {
          const status = document.createElement("div");
          status.className = "requirement-current-step";
          status.textContent = message.status;
          bubble.append(status);
        }

        if (message.steps?.length && message.streaming) {
          const log = document.createElement("div");
          log.className = "requirement-step-log";
          for (const step of message.steps.slice(-3)) {
            const item = document.createElement("span");
            item.textContent = step;
            log.append(item);
          }
          bubble.append(log);
        }
      }

      const content = document.createElement("p");
      content.textContent = message.content.trim() || (message.streaming ? "正在处理你的请求..." : "");
      bubble.append(content);

      chatMessages.appendChild(bubble);
    }

    if (wasNearBottom) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  async function sendMessage(message: string) {
    if (!message.trim() || chatInput.disabled) return;

    messages = [...messages, { role: "user", content: message }];
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      status: "正在理解你的指令",
      startedAt: Date.now(),
      elapsedSec: 0,
      steps: ["正在理解你的指令"]
    };
    messages = [...messages, assistantMessage];
    saveMessages();

    startChatTicker();
    renderMessages();
    chatInput.value = "";
    chatInput.disabled = true;
    sendButton.disabled = true;

    try {
      await config.onSubmit(message);
    } catch (error) {
      assistantMessage.streaming = false;
      assistantMessage.status = "处理失败";
      assistantMessage.content = error instanceof Error ? error.message : "对话失败";
      stopChatTicker();
      saveMessages();
      renderMessages();
    } finally {
      chatInput.disabled = false;
      sendButton.disabled = false;
    }
  }

  function updateAssistantMessage(content: string, streaming: boolean, status?: string) {
    const lastAssistant = messages.filter(m => m.role === "assistant").pop();
    if (lastAssistant) {
      lastAssistant.content = content;
      lastAssistant.streaming = streaming;
      if (status) lastAssistant.status = status;
      if (!streaming) {
        lastAssistant.elapsedSec = lastAssistant.startedAt ? Math.max(0, Math.floor((Date.now() - lastAssistant.startedAt) / 1000)) : 0;
        stopChatTicker();
      }
      saveMessages();
      renderMessages();
    }
  }

  // 仅首次打开时添加欢迎消息
  if (messages.length === 0) {
    messages.push({
      role: "assistant",
      content: "你好！我是AI调度助手。你可以问我关于出发时间、集合点位置、绕路情况等问题。",
      streaming: false
    });
  }
  renderMessages();

  // 事件监听
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(chatInput.value);
  });

  closeButton.addEventListener("click", () => {
    config.onClose();
  });

  suggestionChips.forEach(chip => {
    chip.addEventListener("click", () => {
      const message = chip.dataset.message || "";
      chatInput.value = message;
      chatInput.focus();
    });
  });

  return {
    element: container,
    sendMessage,
    updateAssistantMessage,
    renderMessages,
    startChatTicker,
    stopChatTicker
  };
}

// 检查是否需要显示问答流程
function needsOnboarding(): boolean {
  const hasValidPeople = state.people.length > 0 &&
    state.people.every(p => p.name?.trim() && p.selectedAddress);
  const hasValidDestination = state.destination?.name && state.destination?.address;
  const hasDriver = state.people.some(p => p.hasCar);

  return !hasValidPeople || !hasValidDestination || !hasDriver;
}

// 创建结果视图（默认显示）
function createResultView() {
  const app = document.createElement("div");
  app.className = "app-shell result-view";

  // 顶部栏
  const header = document.createElement("header");
  header.className = "topbar";
  header.innerHTML = `
    <div class="brand-block">
      <span class="brand-mark">接</span>
      <div>
        <h1>接人路线规划</h1>
        <p>多人点位、司机分配、集合路线</p>
      </div>
    </div>
    <div class="topbar-status" aria-label="当前规划状态">
      <span id="peopleCount">0 人</span>
      <span id="driverCount">0 车</span>
      <span id="meetingCount">0 集合点</span>
    </div>
  `;

  // 主工作区
  const main = document.createElement("main");
  main.className = "workspace result-workspace";

  // 地图背景（始终显示）
  const mapSection = document.createElement("section");
  mapSection.className = "map-panel-full";
  const mapStage = document.createElement("div");
  mapStage.className = "map-stage-full";
  const mapContainer = document.createElement("div");
  mapContainer.id = "map";
  const mapLegend = document.createElement("div");
  mapLegend.className = "map-legend";
  mapLegend.setAttribute("aria-hidden", "true");
  mapLegend.innerHTML = `
    <span><i class="legend-dot driver"></i>司机</span>
    <span><i class="legend-dot passenger"></i>乘客</span>
    <span><i class="legend-dot meeting"></i>集合点</span>
    <span><i class="legend-dot destination"></i>终点</span>
  `;
  mapStage.appendChild(mapContainer);
  mapStage.appendChild(mapLegend);
  mapSection.appendChild(mapStage);

  // 结果面板（浮动在地图上）
  const resultPanel = document.createElement("aside");
  resultPanel.className = "result-panel-main";
  resultPanel.innerHTML = `
    <div class="result-panel-header">
      <h2>路线结果</h2>
      <p>生成规划后查看详细路线</p>
      <div class="result-panel-header-actions">
        <span style="flex: 1"></span>
        <button id="editManifestInline" class="edit-link-button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          修改行程信息
        </button>
      </div>
    </div>
    <div id="resultHost"></div>
    <div class="action-buttons">
      <button id="viewMapButton" class="view-map-button large" ${!state.routeResult ? "disabled" : ""}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 1 6"/>
          <line x1="8" y1="2" x2="23" y2="2"/>
          <line x1="12" y1="6" x2="12" y2="22"/>
          <line x1="16" y1="6" x2="16" y2="22"/>
        </svg>
        查看地图
      </button>
      <button id="planButton" class="primary-button large">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="3 11 22 2 13 21 11 13 3 11"/>
        </svg>
        常规生成
      </button>
      <button id="smartPlanButton" class="secondary-button large smart-route-button">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2a10 10 0 1 0 10 10H12V2z"/>
          <path d="M12 12L2.1 12.1"/>
          <path d="M12 12l8.5-8.5"/>
          <path d="M12 12l8.5 8.5"/>
        </svg>
        AI智能规划
      </button>
      <button id="aiChatButton" class="ai-chat-button large" style="display: none;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        AI助手
      </button>
    </div>
  `;

  // 地图在前，面板在后（z-index 控制）
  main.appendChild(mapSection);
  main.appendChild(resultPanel);
  app.appendChild(header);
  app.appendChild(main);

  // 初始化地图
  const mapView = createAMapView(mapContainer);
  mapViewInstance = mapView;

  // 获取DOM元素
  const peopleCount = header.querySelector("#peopleCount")!;
  const driverCount = header.querySelector("#driverCount")!;
  const meetingCount = header.querySelector("#meetingCount")!;
  const resultHost = resultPanel.querySelector<HTMLElement>("#resultHost")!;
  const planButton = resultPanel.querySelector("#planButton")! as HTMLButtonElement;
  const smartPlanButton = resultPanel.querySelector("#smartPlanButton")! as HTMLButtonElement;
  const editInlineButton = resultPanel.querySelector("#editManifestInline")! as HTMLButtonElement;
  const viewMapButton = resultPanel.querySelector("#viewMapButton")! as HTMLButtonElement;
  const aiChatButton = resultPanel.querySelector("#aiChatButton")! as HTMLButtonElement;

  // 更新状态
  function updateUI() {
    saveState(state);
    renderRouteResult(resultHost, state.routeResult, state.error, state.loading);

    const drivers = state.people.filter(p => p.hasCar).length;
    peopleCount.textContent = `${state.people.length} 人`;
    driverCount.textContent = `${drivers} 车`;
    meetingCount.textContent = `${state.meetingPoints.length} 集合点`;

    // 更新地图
    mapView.update(state);

    // 更新查看地图按钮状态
    if (state.routeResult) {
      viewMapButton.disabled = false;
      // AI智能规划后显示AI助手按钮
      if (state.routeResult.source === "smart") {
        aiChatButton.style.display = "flex";
      } else {
        aiChatButton.style.display = "none";
      }
    } else {
      viewMapButton.disabled = true;
      aiChatButton.style.display = "none";
    }
  }

  // 查看地图
  viewMapButton.addEventListener("click", () => {
    if (state.routeResult) {
      switchToMapView();
    }
  });

  // 修改行程
  editInlineButton.addEventListener("click", () => {
    showOnboarding();
  });

  // AI助手按钮
  aiChatButton.addEventListener("click", () => {
    showRequirementDialog();
  });

  // 生成路线
  planButton.addEventListener("click", () => generateRoute("manual"));
  smartPlanButton.addEventListener("click", () => generateRoute("smart"));

  async function generateRoute(mode: "manual" | "smart") {
    const validationError = validateInput(mode);
    if (validationError) {
      state.error = validationError;
      state.routeResult = null;
      updateUI();
      return;
    }

    state.loading = true;
    state.error = null;
    planButton.disabled = true;
    smartPlanButton.disabled = true;
    viewMapButton.disabled = true;
    updateUI();

    try {
      const payload = buildPayload();
      const endpoint = mode === "smart" ? "/api/route/smart-plan" : "/api/route/plan";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "路线规划失败");

      state.routeResult = data;
      state.error = null;
      // 新路线生成，清空旧对话历史
      requirementChatMessages = [];
    } catch (error) {
      state.error = error instanceof Error ? error.message : "路线规划失败";
      state.routeResult = null;
    } finally {
      state.loading = false;
      planButton.disabled = false;
      smartPlanButton.disabled = false;
      updateUI();
    }
  }

  // 显示需求对话框
  function showRequirementDialog() {
    // 关闭已存在的对话框
    const existingDialog = document.querySelector(".requirement-dialog-overlay");
    if (existingDialog) {
      existingDialog.remove();
    }

    // 重置对话框实例
    requirementDialogInstance = null;

    requirementDialogInstance = createRequirementDialog({
      onSubmit: async (message) => {
        return sendRequirementChat(message);
      },
      onClose: () => {
        requirementDialogInstance?.element.remove();
        requirementDialogInstance = null;
      },
      initialMessages: requirementChatMessages,
      onMessagesUpdate: (messages) => {
        requirementChatMessages = messages;
      }
    });

    document.body.appendChild(requirementDialogInstance.element);
  }

  // 发送需求到chat接口
  async function sendRequirementChat(message: string) {
    if (!requirementDialogInstance) return;

    const chatHistory: ChatMessage[] = [];
    // 收集对话框中的历史消息
    const messageElements = requirementDialogInstance.element.querySelectorAll(".requirement-chat-message");
    messageElements.forEach(el => {
      const role = el.classList.contains("user") ? "user" : "assistant";
      const content = el.querySelector("p")?.textContent || "";
      if (content) {
        chatHistory.push({ role, content });
      }
    });

    try {
      const response = await fetch("/api/route/chat-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          appState: state,
          routeResult: state.routeResult,
          history: chatHistory
            .filter(item => item.content.trim())
            .slice(-10)
            .map(item => ({ role: item.role, content: item.content }))
        })
      });

      if (!response.ok || !response.body) {
        throw new Error("对话失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let manifestChanged = false;
      let routeFresh = false;

      const handleEvent = (event: string, data: any) => {
        if (event === "token") {
          // 更新AI回复内容
          const currentContent = requirementDialogInstance?.element.querySelector(".requirement-chat-message.assistant:last-child p")?.textContent || "";
          requirementDialogInstance?.updateAssistantMessage(currentContent + (data.content || ""), true, "正在输出回答");
        }
        if (event === "tool" || event === "agent_step") {
          const label = data.label || data.message || "正在处理";
          requirementDialogInstance?.updateAssistantMessage("", true, label);
        }
        if (event === "manifest_patch") {
          manifestChanged = true;
          requirementDialogInstance?.updateAssistantMessage("", true, "已更新行程清单");
          // 应用manifest patch
          applyManifestPatch(data.patch || {});
        }
        if (event === "route_result") {
          routeFresh = true;
          requirementDialogInstance?.updateAssistantMessage("", true, "已生成新路线");
          // 更新路线结果
          state.routeResult = normalizeRouteResponse(data.routeResult);
          state.hasGeneratedRoute = true;
          state.loading = false;
          state.error = null;
          saveState(state);
          updateUI();
        }
        if (event === "done") {
          requirementDialogInstance?.updateAssistantMessage(
            requirementDialogInstance?.element.querySelector(".requirement-chat-message.assistant:last-child p")?.textContent || "处理完成",
            false,
            "处理完成"
          );
        }
        if (event === "error") {
          const currentContent = requirementDialogInstance?.element.querySelector(".requirement-chat-message.assistant:last-child p")?.textContent || "";
          requirementDialogInstance?.updateAssistantMessage(
            currentContent + `\n${data.error || "对话失败"}`,
            false,
            "处理失败"
          );
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseChunk(buffer, handleEvent);
      }

      // 如果清单已改但未收到路线结果，自动尝试同步
      if (manifestChanged && !routeFresh) {
        requirementDialogInstance?.updateAssistantMessage("", true, "正在根据新行程同步路线");
        const syncMode: "manual" | "smart" = state.meetingPoints.length ? "manual" : "smart";
        const validationError = validateInput(syncMode);
        if (!validationError) {
          try {
            const payload = buildPayload();
            const endpoint = syncMode === "smart" ? "/api/route/smart-plan" : "/api/route/plan";
            const response = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            const data = await readApiJson(response);
            if (response.ok) {
              const result = normalizeRouteResponse(data);
              state.routeResult = result;
              state.hasGeneratedRoute = true;
              state.error = null;
              saveState(state);
              updateUI();
              requirementDialogInstance?.updateAssistantMessage("路线已按新清单同步更新。", false, "处理完成");
            }
          } catch {
            // sync failed silently — user can click generate manually
          }
        }
      }

    } catch (error) {
      const currentContent = requirementDialogInstance?.element.querySelector(".requirement-chat-message.assistant:last-child p")?.textContent || "";
      requirementDialogInstance?.updateAssistantMessage(
        currentContent + (error instanceof Error ? error.message : "对话失败"),
        false,
        "处理失败"
      );
    }
  }

  // 应用manifest patch
  function applyManifestPatch(patch: any) {
    if (patch.city) {
      state.city = patch.city;
    }
    if (patch.timeConstraint !== undefined) {
      state.timeConstraint = patch.timeConstraint;
    }
    if (patch.destination !== undefined) {
      if (!patch.destination || typeof patch.destination === "string") {
        state.destination = null;
        state.destinationInput = "";
      } else {
        state.destination = {
          id: `${patch.destination.name}-${patch.destination.lng}-${patch.destination.lat}`,
          name: patch.destination.name,
          address: patch.destination.address || patch.destination.name,
          lng: patch.destination.lng,
          lat: patch.destination.lat
        };
        state.destinationInput = state.destination.name;
      }
    }
    if (patch.people?.length) {
      state.people = patch.people.map((item: any) => {
        const existing = state.people.find(p => p.id === item.id) || state.people.find(p => p.name && p.name === item.name);
        return {
          id: existing?.id || item.id || Math.random().toString(36).slice(2, 9),
          name: item.name || existing?.name || "",
          addressInput: item.address || existing?.addressInput || "",
          selectedAddress: (item.lng && item.lat) ? {
            id: `${item.name}-${item.lng}-${item.lat}`,
            name: item.name,
            address: item.address || item.name,
            lng: item.lng,
            lat: item.lat
          } : existing?.selectedAddress || null,
          hasCar: item.hasCar ?? existing?.hasCar ?? false,
          note: item.note ?? existing?.note ?? "",
          assignedDriverId: item.assignedDriverId || existing?.assignedDriverId || ""
        };
      });
    }
    if (patch.clearMeetingPoints) {
      state.meetingPoints = [];
    }
    if (patch.meetingPoints) {
      state.meetingPoints = patch.meetingPoints.map((item: any) => {
        const existing = state.meetingPoints.find(m => m.id === item.id) || state.meetingPoints.find(m => m.name === item.name);
        return {
          id: existing?.id || item.id || Math.random().toString(36).slice(2, 9),
          name: item.name || existing?.name || "集合点",
          addressInput: item.address || existing?.addressInput || "",
          selectedAddress: (item.lng && item.lat) ? {
            id: `${item.name}-${item.lng}-${item.lat}`,
            name: item.name,
            address: item.address || item.name,
            lng: item.lng,
            lat: item.lat
          } : existing?.selectedAddress || null,
          memberIds: item.memberIds || existing?.memberIds || [],
          assignedDriverId: item.assignedDriverId || existing?.assignedDriverId || ""
        };
      });
    }
    saveState(state);
  }

  // 标准化路线响应
  function normalizeRouteResponse(result: any): RoutePlanResponse {
    return {
      ...result,
      alternatives: result.alternatives || [],
      driverCandidates: result.driverCandidates || [],
      driverRoutes: result.driverRoutes || (result.best ? [result.best] : []),
      meetingRoutes: result.meetingRoutes || [],
      executionTimeline: result.executionTimeline || [],
      memberPlans: result.memberPlans || [],
      planWarnings: result.planWarnings || []
    };
  }

  function validateInput(mode: "manual" | "smart"): string | null {
    if (!state.destination) return "请先确认终点坐标";
    const readyPeople = state.people.filter(p => p.name && p.selectedAddress);
    if (readyPeople.length !== state.people.length) return "请为每个人填写姓名并确认地址坐标";
    if (mode === "manual") {
      const readyMeetings = state.meetingPoints.filter(m => m.selectedAddress && m.memberIds.length);
      if (readyMeetings.length !== state.meetingPoints.length) return "请为每个集合点确认地址，并至少拖入1位乘客";
    }
    if (!state.people.some(p => p.hasCar)) return "请至少勾选1位开车人员";
    return null;
  }

  function buildPayload() {
    return {
      people: state.people.map(p => ({
        id: p.id,
        name: p.name,
        address: p.selectedAddress?.address || p.addressInput,
        location: { lng: p.selectedAddress!.lng, lat: p.selectedAddress!.lat },
        hasCar: p.hasCar,
        note: p.note,
        assignedDriverId: p.assignedDriverId || undefined
      })),
      city: state.city,
      destination: {
        name: state.destination!.name,
        address: state.destination!.address || state.destinationInput,
        location: { lng: state.destination!.lng, lat: state.destination!.lat }
      },
      meetingPoints: state.meetingPoints.map(m => ({
        id: m.id,
        name: m.name,
        address: m.selectedAddress?.address || m.addressInput,
        location: { lng: m.selectedAddress!.lng, lat: m.selectedAddress!.lat },
        memberIds: m.memberIds,
        assignedDriverId: m.assignedDriverId || undefined
      })),
      timeConstraint: state.timeConstraint
    };
  }

  updateUI();

  return { app, updateUI };
}

// 创建地图视图
function createMapScreenView() {
  const app = document.createElement("div");
  app.className = "app-shell map-view";

  // 地图顶部栏
  const header = document.createElement("header");
  header.className = "map-topbar";
  header.innerHTML = `
    <button id="backToResult" class="back-button">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
      返回
    </button>
    <div class="map-title">
      <h1>路线地图</h1>
      <p id="mapStatusText">准备就绪</p>
    </div>
    <div></div>
  `;

  // 地图区域
  const mapSection = document.createElement("section");
  mapSection.className = "map-container";

  const mapStage = document.createElement("div");
  mapStage.className = "map-stage-full";

  const mapContainer = document.createElement("div");
  mapContainer.id = "map";

  const mapLegend = document.createElement("div");
  mapLegend.className = "map-legend";
  mapLegend.setAttribute("aria-hidden", "true");
  mapLegend.innerHTML = `
    <span><i class="legend-dot driver"></i>司机</span>
    <span><i class="legend-dot passenger"></i>乘客</span>
    <span><i class="legend-dot meeting"></i>集合点</span>
    <span><i class="legend-dot destination"></i>终点</span>
  `;

  mapStage.appendChild(mapContainer);
  mapStage.appendChild(mapLegend);
  mapSection.appendChild(mapStage);

  app.appendChild(header);
  app.appendChild(mapSection);

  // 初始化地图
  const mapView = createAMapView(mapContainer);
  mapViewInstance = mapView;

  // 返回按钮
  const backButton = header.querySelector("#backToResult")! as HTMLButtonElement;
  backButton.addEventListener("click", () => {
    switchToResultView();
  });

  // 更新地图状态
  const mapStatusText = header.querySelector("#mapStatusText")!;
  if (state.routeResult) {
    mapStatusText.textContent = state.routeResult.source === "smart"
      ? "AI集合方案已生成"
      : state.routeResult.mode === "multi-driver"
      ? "多司机路线已生成"
      : "推荐路线已生成";
  }

  // 更新地图数据
  mapView.update(state);

  return { app, mapView };
}

// 切换到地图视图
function switchToMapView() {
  currentView = "map";
  const appRoot = document.querySelector("#app");
  if (!appRoot) return;

  appRoot.innerHTML = "";

  const { app } = createMapScreenView();
  appRoot.appendChild(app);
}

// 切换到结果视图
function switchToResultView() {
  currentView = "result";
  const appRoot = document.querySelector("#app");
  if (!appRoot) return;

  appRoot.innerHTML = "";

  const { app } = createResultView();
  appRoot.appendChild(app);
}

// 创建问答流程
function showOnboarding() {
  const existingApp = document.querySelector<HTMLElement>("#app");
  if (existingApp) {
    existingApp.style.display = "none";
  }

  let onboardingContainer = document.querySelector<HTMLElement>("#onboarding");
  if (!onboardingContainer) {
    onboardingContainer = document.createElement("div");
    onboardingContainer.id = "onboarding";
    document.body.appendChild(onboardingContainer);
  }

  onboardingContainer.innerHTML = "";
  onboardingContainer.style.display = "block";

  const flow = createOnboardingFlow();
  onboardingContainer.appendChild(flow.element);

  flow.element.addEventListener("onboarding-complete", (e: Event) => {
    const customEvent = e as CustomEvent<{ state: AppState }>;
    state = customEvent.detail.state;

    setTimeout(() => {
      if (onboardingContainer) {
        onboardingContainer.style.display = "none";
      }

      const existingApp = document.querySelector<HTMLElement>("#app");
      if (existingApp) {
        existingApp.style.display = "block";
      }

      initializeApp();
    }, 500);
  });
}

function initializeApp() {
  const appRoot = document.querySelector("#app");
  if (!appRoot) return;

  appRoot.innerHTML = "";

  if (needsOnboarding()) {
    showOnboarding();
  } else {
    const { app } = createResultView();
    appRoot.appendChild(app);
  }
}

// 初始化
document.addEventListener("DOMContentLoaded", initializeApp);
