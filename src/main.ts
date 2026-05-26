import "./styles.css";
import { createMeetingPoint, createPerson, createSuggestion, loadState, saveState } from "./store";
import { createMapView } from "./ui/mapView";
import { renderMeetingPoints } from "./ui/meetingPoints";
import { renderPersonList } from "./ui/personList";
import { renderRouteResult } from "./ui/routeResult";
import { createAddressInput } from "./ui/addressInput";
import type { AppState, RoutePlanResponse, Suggestion, TimeConstraint } from "./types";

let state = loadState();
type ChatMessage = {
  role: "assistant" | "user";
  content: string;
  source?: "model" | "fallback";
  streaming?: boolean;
  status?: string;
  startedAt?: number;
  elapsedSec?: number;
  steps?: string[];
};
type ManifestPatch = {
  city?: string;
  destination?: { name: string; address: string; lng: number; lat: number } | string | null;
  timeConstraint?: TimeConstraint | null;
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
let chatMessages: ChatMessage[] = [
  { role: "assistant", content: "可以直接让我生成规划，也可以问某个人几点出发。我会把完整方案放到右侧，只在这里给结论。" }
];
let agentSteps: string[] = [];
let focusPersonId = "";
let focusStopId = "";
let chatTickTimer: number | null = null;
let lastPlanMode: "manual" | "smart" = "manual";
let chatBusy = false;
const REQUEST_OVERLOAD_MESSAGE =
  "请求过量了，高德或模型接口暂时没有返回可用结果。请等几十秒后再试，或者减少一次规划里的集合点/成员数量。";

function friendlyErrorMessage(error: unknown, fallback = "请求处理失败，请稍后再试。") {
  const message = error instanceof Error ? error.message : String(error || "");
  if (
    !message ||
    /REQUEST_OVERLOAD|CUQPS|QPS|rate.?limit|too many|429|subrequest|高德请求失败|高德返回错误|DeepSeek 请求失败|fetch failed|network|timeout|HTTP 5\d\d/i.test(
      message
    )
  ) {
    return REQUEST_OVERLOAD_MESSAGE;
  }
  return message || fallback;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root not found");

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-block">
        <img class="brand-mark" src="/logo1.png" alt="RouteOS" />
        <div>
          <h1>RouteOS</h1>
          <p>多人点位、司机分配、集合路线 · 贡献者：wegotnoplan、mt-gao</p>
        </div>
      </div>
      <div class="topbar-status" aria-label="当前规划状态">
        <span id="peopleCount">0 人</span>
        <span id="driverCount">0 车</span>
        <span id="meetingCount">0 集合点</span>
      </div>
      <div class="city-control">
        <label class="field-label compact" for="cityInput">城市</label>
        <div class="city-input-wrap">
          <input id="cityInput" class="text-input city-input" value="${state.city}" autocomplete="off" />
          <div id="citySuggestions" class="suggestion-menu"></div>
        </div>
      </div>
    </header>
    <main class="workspace">
      <section class="input-panel">
        <div class="panel-heading">
          <span>Manifest</span>
          <h2>行程清单</h2>
          <p>先确认终点，再把乘客、司机和集合点排进路线。</p>
        </div>
        <div id="destinationHost"></div>
        <div id="personListHost"></div>
        <div id="meetingPointsHost"></div>
        <div class="action-row">
          <button id="planButton" class="primary-button" type="button">常规生成</button>
          <button id="smartPlanButton" class="secondary-button smart-route-button" type="button">AI生成规划(跳过集合点)</button>
        </div>
      </section>
      <div class="resize-handle resize-left" title="拖动调整输入区宽度"></div>
      <section class="map-panel">
        <div class="map-stage">
          <div id="map"></div>
          <div class="map-hud" aria-hidden="true">
            <span>Route Canvas</span>
            <strong id="mapStatus">等待点位</strong>
          </div>
          <div class="map-legend" aria-hidden="true">
            <span><i class="legend-dot driver"></i>司机</span>
            <span><i class="legend-dot passenger"></i>乘客</span>
            <span><i class="legend-dot meeting"></i>集合点</span>
            <span><i class="legend-dot destination"></i>终点</span>
          </div>
        </div>
      </section>
      <div class="resize-handle resize-right" title="拖动调整结果区宽度"></div>
      <aside class="result-panel">
        <div class="result-scroll-region">
          <div class="panel-heading result-heading">
            <span>Decision</span>
            <h2>路线结果</h2>
            <p>生成后查看司机路线、集合方式和备选顺序。</p>
          </div>
          <div id="resultHost"></div>
        </div>
        <div class="right-splitter" title="拖动调整计划清单和聊天框高度"></div>
        <section class="route-chat-panel" aria-label="AI 调度对话">
          <div class="chat-heading">
            <span>AI Dispatcher</span>
            <strong>方案对话</strong>
          </div>
          <div id="agentSteps" class="agent-steps" aria-live="polite"></div>
          <div id="chatMessages" class="chat-messages"></div>
          <div id="chatDisabledOverlay" class="chat-disabled-overlay">请先在左侧填写行程信息并生成路线后开始对话</div>
          <form id="chatForm" class="chat-form">
            <textarea id="chatInput" class="text-input" rows="2" placeholder="问 AI 调整路线，例如：叶哥几点下楼？"></textarea>
            <button id="chatSendButton" class="secondary-button" type="submit">发送</button>
          </form>
        </section>
      </aside>
    </main>
  </div>
  <div id="welcomeModal" class="welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcomeTitle">
    <div class="welcome-dialog">
      <span class="welcome-kicker">RouteOS</span>
      <h2 id="welcomeTitle">多人接送路线调度台</h2>
      <p>RouteOS 用来把终点、乘客、司机和集合点整理成可执行的接人方案。它会基于高德路线估算接人顺序、集合方式、每个人的出发/上车时间，并提供可复制到微信的路线摘要。</p>
      <div class="welcome-grid">
        <section>
          <h3>最佳实践</h3>
          <ol>
            <li>先确认城市、终点和每个人的地址坐标。</li>
            <li>勾选司机，必要时把成员拖入集合点。</li>
            <li>如有到达时间，先在左侧填好，再生成路线。</li>
            <li>生成后先看地图路线，再复制右侧摘要发给成员。</li>
            <li>跟AI对话可以调整路线方案、修改清单或确认出发时间。</li>
          </ol>
        </section>
        <section>
          <h3>贡献者</h3>
          <div class="contributors">
            <div class="contributor">
              <img class="contributor-avatar" src="https://avatars.githubusercontent.com/u/88580745?v=4" alt="wegotnoplan" />
              <i>wegotnoplan</i>
            </div>
            <div class="contributor">
              <img class="contributor-avatar" src="https://avatars.githubusercontent.com/u/96906510?v=4" alt="mt-gao" />
              <i>mt-gao</i>
            </div>
          </div>
        </section>
      </div>
      <div class="welcome-notes">
        <strong>备注</strong>
        <ol>
          <li>高德服务不支持高并发，请不要连续点击路线生成。</li>
          <li>AI功能由DeepSeek v4 Flash实现，无法对话联系高哥。</li>
        </ol>
      </div>
      <button id="welcomeCloseButton" class="primary-button" type="button">进入 RouteOS</button>
    </div>
  </div>
`;

const destinationHost = document.querySelector<HTMLElement>("#destinationHost")!;
const personListHost = document.querySelector<HTMLElement>("#personListHost")!;
const meetingPointsHost = document.querySelector<HTMLElement>("#meetingPointsHost")!;
const resultHost = document.querySelector<HTMLElement>("#resultHost")!;
const cityInput = document.querySelector<HTMLInputElement>("#cityInput")!;
const planButton = document.querySelector<HTMLButtonElement>("#planButton")!;
const smartPlanButton = document.querySelector<HTMLButtonElement>("#smartPlanButton")!;
const welcomeModal = document.querySelector<HTMLElement>("#welcomeModal")!;
const welcomeCloseButton = document.querySelector<HTMLButtonElement>("#welcomeCloseButton")!;
const workspace = document.querySelector<HTMLElement>(".workspace")!;
const resultPanel = document.querySelector<HTMLElement>(".result-panel")!;
const leftResizeHandle = document.querySelector<HTMLElement>(".resize-left")!;
const rightResizeHandle = document.querySelector<HTMLElement>(".resize-right")!;
const rightSplitter = document.querySelector<HTMLElement>(".right-splitter")!;
const peopleCount = document.querySelector<HTMLElement>("#peopleCount")!;
const driverCount = document.querySelector<HTMLElement>("#driverCount")!;
const meetingCount = document.querySelector<HTMLElement>("#meetingCount")!;
const mapStatus = document.querySelector<HTMLElement>("#mapStatus")!;
const inputPanel = document.querySelector<HTMLElement>(".input-panel")!;
const agentStepsHost = document.querySelector<HTMLElement>("#agentSteps")!;
const chatMessagesHost = document.querySelector<HTMLElement>("#chatMessages")!;
const chatForm = document.querySelector<HTMLFormElement>("#chatForm")!;
const chatInput = document.querySelector<HTMLTextAreaElement>("#chatInput")!;
const chatSendButton = document.querySelector<HTMLButtonElement>("#chatSendButton")!;
const chatDisabledOverlay = document.querySelector<HTMLElement>("#chatDisabledOverlay")!;
const mapView = createMapView(document.querySelector<HTMLElement>("#map")!, {
  onCityDetected(city) {
    if (!state.destination && state.city === "深圳") {
      state.city = city;
      cityInput.value = city;
      saveState(state);
    }
  }
});

function applySavedPanelWidths() {
  const left = localStorage.getItem("pickup-route-left-panel-width");
  const right = localStorage.getItem("pickup-route-right-panel-width");
  const chatHeight = localStorage.getItem("pickup-route-right-chat-height");
  if (left) workspace.style.setProperty("--left-panel-width", `${Number(left)}px`);
  if (right) workspace.style.setProperty("--right-panel-width", `${Number(right)}px`);
  if (chatHeight) resultPanel.style.setProperty("--right-chat-height", `${Number(chatHeight)}px`);
}

function startResize(side: "left" | "right", event: PointerEvent) {
  if (window.matchMedia("(max-width: 1060px)").matches) return;
  event.preventDefault();
  const min = 280;
  const max = 560;
  const workspaceRect = workspace.getBoundingClientRect();
  const onMove = (moveEvent: PointerEvent) => {
    if (side === "left") {
      const width = Math.max(min, Math.min(max, moveEvent.clientX - workspaceRect.left));
      workspace.style.setProperty("--left-panel-width", `${width}px`);
      localStorage.setItem("pickup-route-left-panel-width", String(Math.round(width)));
    } else {
      const width = Math.max(min, Math.min(max, workspaceRect.right - moveEvent.clientX));
      workspace.style.setProperty("--right-panel-width", `${width}px`);
      localStorage.setItem("pickup-route-right-panel-width", String(Math.round(width)));
    }
  };
  const onUp = () => {
    document.body.classList.remove("resizing-layout");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  document.body.classList.add("resizing-layout");
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function startRightPanelResize(event: PointerEvent) {
  if (window.matchMedia("(max-width: 1060px)").matches) return;
  event.preventDefault();
  const rect = resultPanel.getBoundingClientRect();
  const min = 190;
  const max = Math.max(230, rect.height - 210);
  const onMove = (moveEvent: PointerEvent) => {
    const height = Math.max(min, Math.min(max, rect.bottom - moveEvent.clientY));
    resultPanel.style.setProperty("--right-chat-height", `${height}px`);
    localStorage.setItem("pickup-route-right-chat-height", String(Math.round(height)));
  };
  const onUp = () => {
    document.body.classList.remove("resizing-stack");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  document.body.classList.add("resizing-stack");
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function persistAndPaint() {
  saveState(state);
  updateChrome();
  mapView.update(state);
  renderRouteResult(resultHost, state.routeResult, state.error, state.loading);
  renderChat();
  applyFocusHighlight();
}

function updateChrome() {
  const drivers = state.people.filter((person) => person.hasCar).length;
  const confirmedPeople = state.people.filter((person) => person.selectedAddress).length;
  const confirmedDestination = state.destination ? 1 : 0;
  peopleCount.textContent = `${state.people.length} 人`;
  driverCount.textContent = `${drivers} 车`;
  meetingCount.textContent = `${state.meetingPoints.length} 集合点`;
  if (state.loading) {
    mapStatus.textContent = "正在计算路线";
  } else if (state.routeResult) {
    mapStatus.textContent =
      state.routeResult.source === "smart" ? "AI集合方案已生成" : state.routeResult.mode === "multi-driver" ? "多司机路线已生成" : "推荐路线已生成";
  } else {
    mapStatus.textContent = `${confirmedPeople + confirmedDestination}/${state.people.length + 1} 坐标确认`;
  }
  const chatReady = state.hasGeneratedRoute === true || state.loading === true || chatBusy;
  chatDisabledOverlay.classList.toggle("visible", !chatReady);
  chatForm.classList.toggle("disabled", !chatReady);
  chatInput.disabled = !chatReady;
  chatSendButton.disabled = !chatReady;
}

function formatElapsed(seconds = 0) {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function normalizeClock(hour: number, minute: number, period = "") {
  let normalizedHour = hour;
  if (/下午|晚上|傍晚/.test(period) && normalizedHour < 12) normalizedHour += 12;
  if (/中午/.test(period) && normalizedHour < 11) normalizedHour += 12;
  if (/凌晨|早上|上午/.test(period) && normalizedHour === 12) normalizedHour = 0;
  if (normalizedHour < 0 || normalizedHour > 23 || minute < 0 || minute > 59) return null;
  return `${String(normalizedHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractTimeConstraint(message: string): TimeConstraint | null {
  const match = message.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})(?:[:：](\d{1,2})|[点时]\s*(\d{1,2})?分?)/);
  if (!match) return null;
  const kind = /出发|发车|开车|开始/.test(message)
    ? "departure"
    : /到达|抵达|到终点|到目的地|到场|到\b|之前|以前|前/.test(message)
      ? "arrival"
      : null;
  if (!kind) return null;
  const hour = Number(match[2]);
  const minute = match[3] === undefined && match[4] === undefined ? 0 : Number(match[3] || match[4]);
  const time = normalizeClock(hour, minute, match[1] || "");
  return time ? { kind, time, source: "chat" } : null;
}

function timeConstraintLabel(timeConstraint: TimeConstraint | null) {
  if (!timeConstraint) return "未设置具体时间";
  return timeConstraint.kind === "arrival" ? `${timeConstraint.time} 到达目的地` : `${timeConstraint.time} 司机出发`;
}

function stopChatTicker() {
  if (chatTickTimer !== null) {
    window.clearInterval(chatTickTimer);
    chatTickTimer = null;
  }
}

function startChatTicker() {
  stopChatTicker();
  chatTickTimer = window.setInterval(() => {
    let changed = false;
    for (const message of chatMessages) {
      if (message.streaming && message.startedAt) {
        message.elapsedSec = Math.max(0, Math.floor((Date.now() - message.startedAt) / 1000));
        changed = true;
      }
    }
    if (changed) renderChat();
  }, 1000);
}

function updateAssistantProgress(message: ChatMessage, status: string) {
  message.status = status;
  message.steps = [...(message.steps || []), status].slice(-4);
  message.elapsedSec = message.startedAt ? Math.max(0, Math.floor((Date.now() - message.startedAt) / 1000)) : message.elapsedSec;
  renderChat();
}

function normalizeRouteResponse(result: RoutePlanResponse): RoutePlanResponse {
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

function renderChat() {
  const wasNearBottom = chatMessagesHost.scrollTop + chatMessagesHost.clientHeight >= chatMessagesHost.scrollHeight - 40;
  agentStepsHost.innerHTML = "";
  chatMessagesHost.innerHTML = "";
  for (const message of chatMessages) {
    const bubble = document.createElement("div");
    bubble.className = `chat-message ${message.role}`;

    if (message.role === "assistant" && (message.streaming || message.status)) {
      const live = document.createElement("div");
      live.className = message.streaming ? "chat-live-status active" : "chat-live-status";
      const elapsed = message.elapsedSec ?? (message.startedAt ? Math.max(0, Math.floor((Date.now() - message.startedAt) / 1000)) : 0);
      live.innerHTML = `
        <span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <strong>${message.streaming ? "思考中" : "已完成"}</strong>
        <time>${formatElapsed(elapsed)}</time>
      `;
      bubble.append(live);

      if (message.status) {
        const status = document.createElement("div");
        status.className = "chat-current-step";
        status.textContent = message.status;
        bubble.append(status);
      }

      if (message.steps?.length && message.streaming) {
        const log = document.createElement("div");
        log.className = "chat-step-log";
        for (const step of message.steps.slice(-3)) {
          const item = document.createElement("span");
          item.textContent = step;
          log.append(item);
        }
        bubble.append(log);
      }
    }

    const content = document.createElement("p");
    content.textContent =
      message.content.trim() || (message.streaming ? "正在处理你的请求，路线计算完成后会在这里继续输出回答。" : "");
    bubble.append(content);
    if (message.source === "fallback") {
      const source = document.createElement("small");
      source.textContent = "本地分析";
      bubble.append(source);
    }
    if (message.source === "model") {
      const source = document.createElement("small");
      source.textContent = message.elapsedSec ? `模型回复，思考 ${formatElapsed(message.elapsedSec)}` : "模型回复";
      bubble.append(source);
    }
    chatMessagesHost.append(bubble);
  }
  if (wasNearBottom) {
    chatMessagesHost.scrollTop = chatMessagesHost.scrollHeight;
  }
}

function localId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function suggestionFromPatch(item: { name: string; address?: string; lng?: number; lat?: number }) {
  if (!Number.isFinite(item.lng) || !Number.isFinite(item.lat)) return null;
  return createSuggestion(item.name, item.address || item.name, Number(item.lng), Number(item.lat));
}

function driverIdByName(name?: string) {
  if (!name) return "";
  return state.people.find((person) => person.name === name && person.hasCar)?.id || "";
}

function personIdByName(name?: string) {
  if (!name) return "";
  return state.people.find((person) => person.name === name)?.id || "";
}

function personPatchKey(item: { id?: string; name?: string }) {
  return item.id || item.name || "";
}

function applyPersonPatch(item: NonNullable<ManifestPatch["people"]>[number], existing?: (typeof state.people)[number]) {
  const suggestion = suggestionFromPatch({ name: item.name || existing?.name || "", address: item.address, lng: item.lng, lat: item.lat });
  return createPerson({
    id: existing?.id || item.id || localId("person"),
    name: item.name || existing?.name || "",
    addressInput: item.address || suggestion?.name || existing?.addressInput || "",
    selectedAddress: suggestion || existing?.selectedAddress || null,
    hasCar: item.hasCar ?? existing?.hasCar ?? false,
    note: item.note ?? existing?.note ?? "",
    assignedDriverId: item.assignedDriverId || driverIdByName(item.assignedDriverName) || existing?.assignedDriverId || ""
  });
}

function applyMeetingPatch(item: NonNullable<ManifestPatch["meetingPoints"]>[number], existing?: (typeof state.meetingPoints)[number]) {
  const suggestion = suggestionFromPatch({ name: item.name || existing?.name || "", address: item.address, lng: item.lng, lat: item.lat });
  const memberIds = item.memberIds || item.memberNames?.map(personIdByName).filter(Boolean) || existing?.memberIds || [];
  return createMeetingPoint({
    id: existing?.id || item.id || localId("meeting"),
    name: item.name || existing?.name || "集合点",
    addressInput: item.address || suggestion?.name || existing?.addressInput || "",
    selectedAddress: suggestion || existing?.selectedAddress || null,
    memberIds,
    assignedDriverId: item.assignedDriverId || driverIdByName(item.assignedDriverName) || existing?.assignedDriverId || ""
  });
}

function isRouteChangeRequest(message: string) {
  return /(修改|调整|改成|改一下|重新安排|重排|换成|改为|分配|安排|让|移到|加入|去.*集合|减少时间|更快|优化|重新规划|生成方案|生成规划)/.test(message);
}

function flashManifestUpdate() {
  inputPanel.classList.add("ai-updated");
  window.setTimeout(() => inputPanel.classList.remove("ai-updated"), 1600);
}

function applyFocusHighlight() {
  document.querySelectorAll(".focus-highlight").forEach((element) => element.classList.remove("focus-highlight"));
  if (focusPersonId) {
    document.querySelector(`[data-person-id="${CSS.escape(focusPersonId)}"]`)?.classList.add("focus-highlight");
    document.querySelector(`[data-person-plan-id="${CSS.escape(focusPersonId)}"]`)?.classList.add("focus-highlight");
  }
  if (focusStopId) {
    document.querySelector(`[data-meeting-id="${CSS.escape(focusStopId)}"]`)?.classList.add("focus-highlight");
  }
}

function applyManifestPatch(patch: ManifestPatch, options: { routeSyncPending?: boolean } = {}) {
  if (patch.city) {
    state.city = patch.city;
    cityInput.value = patch.city;
  }

  if (patch.timeConstraint !== undefined) {
    state.timeConstraint = patch.timeConstraint;
  }

  if (patch.destination !== undefined) {
    if (!patch.destination || typeof patch.destination === "string") {
      state.destination = null;
      state.destinationInput = "";
    } else {
      const suggestion = suggestionFromPatch(patch.destination);
      state.destination = suggestion;
      state.destinationInput = suggestion?.name || patch.destination.name;
    }
  }

  if (patch.people?.length) {
    const patchKeys = new Set(patch.people.map(personPatchKey).filter(Boolean));
    state.people = [
      ...state.people.map((person) => {
        const item = patch.people!.find((candidate) => candidate.id === person.id || (candidate.name && candidate.name === person.name));
        return item ? applyPersonPatch(item, person) : person;
      }),
      ...patch.people
        .filter((item) => {
          const key = personPatchKey(item);
          return key && !state.people.some((person) => person.id === item.id || person.name === item.name) && patchKeys.has(key);
        })
        .map((item) => applyPersonPatch(item))
    ];
  }

  const baseMeetingPoints = patch.clearMeetingPoints ? [] : state.meetingPoints;

  if (patch.meetingPoints) {
    state.meetingPoints = [
      ...baseMeetingPoints.map((meeting) => {
        const item = patch.meetingPoints!.find((candidate) => candidate.id === meeting.id || candidate.name === meeting.name);
        return item ? applyMeetingPatch(item, meeting) : meeting;
      }),
      ...patch.meetingPoints
        .filter((item) => !baseMeetingPoints.some((meeting) => meeting.id === item.id || meeting.name === item.name))
        .map((item) => applyMeetingPatch(item))
    ];
  } else if (patch.clearMeetingPoints) {
    state.meetingPoints = [];
  }

  state.routeResult = null;
  if (options.routeSyncPending) {
    state.loading = true;
    state.error = null;
  }
  renderDestination();
  renderPeople();
  renderMeetings();
  persistAndPaint();
  flashManifestUpdate();
  applyFocusHighlight();
}

function patchState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  persistAndPaint();
}

function renderDestination() {
  destinationHost.innerHTML = "";
  destinationHost.append(
    createAddressInput({
      label: "终点地址",
      placeholder: "输入终点地址或景区/酒店",
      value: state.destinationInput,
      selected: state.destination,
      city: state.city,
      onInput: (value) => {
        state.destinationInput = value;
        state.destination = null;
        state.routeResult = null;
        persistAndPaint();
      },
      onSelect: (suggestion) => {
        state.destinationInput = suggestion.name;
        state.destination = suggestion;
        state.routeResult = null;
        persistAndPaint();
      }
    })
  );

  const schedule = document.createElement("div");
  schedule.className = "time-constraint-panel";
  const inputId = "arrivalTimeInput";
  const arrivalValue = state.timeConstraint?.kind === "arrival" ? state.timeConstraint.time : "";
  schedule.innerHTML = `
    <label class="field-label compact" for="${inputId}">到达时间</label>
    <div class="time-constraint-row">
      <input id="${inputId}" class="text-input" type="time" value="${arrivalValue}" />
      <button class="secondary-button compact-button" type="button">清除</button>
    </div>
    <div class="inline-note">${timeConstraintLabel(state.timeConstraint)}</div>
  `;
  const arrivalInput = schedule.querySelector<HTMLInputElement>("input")!;
  const clearButton = schedule.querySelector<HTMLButtonElement>("button")!;
  arrivalInput.addEventListener("input", () => {
    state.timeConstraint = arrivalInput.value ? { kind: "arrival", time: arrivalInput.value, source: "manual" } : null;
    state.routeResult = null;
    renderDestination();
    persistAndPaint();
  });
  clearButton.disabled = !state.timeConstraint;
  clearButton.addEventListener("click", () => {
    state.timeConstraint = null;
    state.routeResult = null;
    renderDestination();
    persistAndPaint();
  });
  destinationHost.append(schedule);
}

function renderPeople() {
  const drivers = state.people.filter((person) => person.hasCar);
  const groupedPersonIds = new Set(state.meetingPoints.flatMap((meeting) => meeting.memberIds));
  renderPersonList(personListHost, {
    people: state.people,
    city: state.city,
    drivers,
    groupedPersonIds,
    onChange: persistAndPaint,
    onAdd: () => {
      if (state.people.length >= 8) return;
      state.people = [...state.people, createPerson()];
      state.routeResult = null;
      renderPeople();
      persistAndPaint();
    },
    onRemove: (id) => {
      state.people = state.people.filter((person) => person.id !== id);
      state.routeResult = null;
      renderPeople();
      persistAndPaint();
    },
    onPersonPatch: (id, patch) => {
      state.people = state.people.map((person) => (person.id === id ? { ...person, ...patch } : person));
      if (patch.hasCar !== undefined) {
        state.meetingPoints = state.meetingPoints.map((meeting) => ({
          ...meeting,
          memberIds: meeting.memberIds.filter((memberId) => memberId !== id)
        }));
        renderPeople();
      }
      state.routeResult = null;
      renderMeetings();
      persistAndPaint();
    },
    onAddressSelect: (id, suggestion: Suggestion) => {
      state.people = state.people.map((person) =>
        person.id === id ? { ...person, addressInput: suggestion.name, selectedAddress: suggestion } : person
      );
      state.routeResult = null;
      renderPeople();
      persistAndPaint();
    }
  });
}

function renderMeetings() {
  const drivers = state.people.filter((person) => person.hasCar);
  renderMeetingPoints(meetingPointsHost, {
    meetingPoints: state.meetingPoints,
    people: state.people,
    drivers,
    city: state.city,
    onCreate: () => {
      state.meetingPoints = [...state.meetingPoints, createMeetingPoint({ name: `集合点 ${state.meetingPoints.length + 1}` })];
      state.routeResult = null;
      renderMeetings();
      renderPeople();
      persistAndPaint();
    },
    onRemove: (id) => {
      state.meetingPoints = state.meetingPoints.filter((meeting) => meeting.id !== id);
      state.routeResult = null;
      renderMeetings();
      renderPeople();
      persistAndPaint();
    },
    onPatch: (id, patch) => {
      state.meetingPoints = state.meetingPoints.map((meeting) => (meeting.id === id ? { ...meeting, ...patch } : meeting));
      state.routeResult = null;
      persistAndPaint();
    },
    onAddressSelect: (id, suggestion) => {
      state.meetingPoints = state.meetingPoints.map((meeting) =>
        meeting.id === id ? { ...meeting, addressInput: suggestion.name, selectedAddress: suggestion } : meeting
      );
      state.routeResult = null;
      persistAndPaint();
    },
    onDropPerson: (meetingId, personId) => {
      const person = state.people.find((candidate) => candidate.id === personId);
      if (!person || person.hasCar) {
        patchState({ error: "司机不能拖入集合点；请只拖需要被接的人。" });
        return;
      }
      state.meetingPoints = state.meetingPoints.map((meeting) => ({
        ...meeting,
        memberIds:
          meeting.id === meetingId
            ? Array.from(new Set([...meeting.memberIds, personId]))
            : meeting.memberIds.filter((id) => id !== personId)
      }));
      state.routeResult = null;
      state.error = null;
      renderMeetings();
      renderPeople();
      persistAndPaint();
    },
    onRemoveMember: (meetingId, personId) => {
      state.meetingPoints = state.meetingPoints.map((meeting) =>
        meeting.id === meetingId ? { ...meeting, memberIds: meeting.memberIds.filter((id) => id !== personId) } : meeting
      );
      state.routeResult = null;
      renderMeetings();
      renderPeople();
      persistAndPaint();
    }
  });
}

function validateInput(mode: "manual" | "smart" = "manual") {
  if (!state.destination) return "请先从候选中确认终点坐标";
  const readyPeople = state.people.filter((person) => person.name && person.selectedAddress);
  if (readyPeople.length !== state.people.length) return "请为每个人填写姓名并确认地址坐标";
  if (mode === "manual") {
    const readyMeetings = state.meetingPoints.filter((meeting) => meeting.selectedAddress && meeting.memberIds.length);
    if (readyMeetings.length !== state.meetingPoints.length) return "请为每个集合点确认地址，并至少拖入 1 位乘客";
  }
  if (!state.people.some((person) => person.hasCar)) return "请至少勾选 1 位开车人员";
  return null;
}

function buildRoutePayload() {
  return {
    people: state.people.map((person) => ({
      id: person.id,
      name: person.name,
      address: person.selectedAddress?.address || person.addressInput,
      location: {
        lng: person.selectedAddress!.lng,
        lat: person.selectedAddress!.lat
      },
      hasCar: person.hasCar,
      note: person.note,
      assignedDriverId: person.assignedDriverId || undefined
    })),
    city: state.city,
    timeConstraint: state.timeConstraint || undefined,
    destination: {
      name: state.destination!.name,
      address: state.destination!.address || state.destinationInput,
      location: {
        lng: state.destination!.lng,
        lat: state.destination!.lat
      }
    },
    meetingPoints: state.meetingPoints.map((meeting) => ({
      id: meeting.id,
      name: meeting.name,
      address: meeting.selectedAddress?.address || meeting.addressInput,
      location: {
        lng: meeting.selectedAddress!.lng,
        lat: meeting.selectedAddress!.lat
      },
      memberIds: meeting.memberIds,
      assignedDriverId: meeting.assignedDriverId || undefined
    }))
  };
}

async function planRoute(mode: "manual" | "smart") {
  lastPlanMode = mode;
  planButton.disabled = true;
  smartPlanButton.disabled = true;

  try {
    await syncRouteFromManifest(mode, { showLoading: true });
  } finally {
    planButton.disabled = false;
    smartPlanButton.disabled = false;
  }
}

async function syncRouteFromManifest(mode: "manual" | "smart", options: { showLoading?: boolean } = {}) {
  const validationError = validateInput(mode);
  if (validationError) {
    patchState({ loading: false, error: validationError, routeResult: null });
    return false;
  }

  if (options.showLoading) {
    patchState({ loading: true, error: null, routeResult: null });
  }

  try {
    const response = await fetch(mode === "smart" ? "/api/route/smart-plan" : "/api/route/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRoutePayload())
    });
    const data = (await response.json()) as RoutePlanResponse | { error?: string };
    if (!response.ok) throw new Error("error" in data ? data.error || "路线规划失败" : "路线规划失败");
    patchState({ loading: false, routeResult: normalizeRouteResponse(data as RoutePlanResponse), error: null, hasGeneratedRoute: true });
    return true;
  } catch (error) {
    patchState({
      loading: false,
      routeResult: null,
      error: friendlyErrorMessage(error, "路线规划失败")
    });
    return false;
  }
}

function parseSseChunk(buffer: string, onEvent: (event: string, data: any) => void) {
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

async function sendChatMessage(message: string) {
  agentSteps = [];
  chatBusy = true;
  updateChrome();
  let manifestChanged = false;
  let routeFreshAfterManifest = false;
  let timeConstraintChanged = false;
  const routeChangeRequest = isRouteChangeRequest(message);
  const hadRouteBeforeTimeConstraint = Boolean(state.routeResult);
  const extractedTimeConstraint = extractTimeConstraint(message);
  if (extractedTimeConstraint) {
    state.timeConstraint = extractedTimeConstraint;
    timeConstraintChanged = true;
    renderDestination();
    persistAndPaint();
  }
  chatMessages = [...chatMessages, { role: "user", content: message }];
  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: "",
    source: "model",
    streaming: true,
    status: "正在理解你的指令",
    startedAt: Date.now(),
    elapsedSec: 0,
    steps: ["正在理解你的指令"]
  };
  chatMessages = [...chatMessages, assistantMessage];
  startChatTicker();
  renderChat();
  chatInput.value = "";
  chatInput.disabled = true;
  chatSendButton.disabled = true;
  planButton.disabled = true;
  smartPlanButton.disabled = true;
  try {
    const response = await fetch("/api/route/chat-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        appState: state,
        routeResult: state.routeResult,
        history: chatMessages
          .filter((item) => item.content.trim())
          .slice(-10)
          .map((item) => ({ role: item.role, content: item.content }))
      })
    });
    if (!response.ok || !response.body) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error || "对话失败");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const handleEvent = (event: string, data: any) => {
      if (event === "token") {
        if (!assistantMessage.content.trim()) assistantMessage.status = "正在输出回答";
        assistantMessage.content += data.content || "";
        renderChat();
      }
      if (event === "tool") {
        agentSteps = [...agentSteps, data.label || "正在调用工具"];
        updateAssistantProgress(assistantMessage, data.label || "正在调用工具");
      }
      if (event === "agent_step") {
        agentSteps = [...agentSteps, data.label || data.message || "正在处理规划"];
        updateAssistantProgress(assistantMessage, data.label || data.message || "正在处理规划");
      }
      if (event === "manifest_patch") {
        manifestChanged = true;
        routeFreshAfterManifest = false;
        updateAssistantProgress(assistantMessage, "已更新左侧行程清单");
        applyManifestPatch(data.patch || {}, { routeSyncPending: true });
        renderChat();
      }
      if (event === "route_result") {
        routeFreshAfterManifest = true;
        updateAssistantProgress(assistantMessage, "已生成路线，正在整理回答");
        state.routeResult = normalizeRouteResponse(data.routeResult as RoutePlanResponse);
        state.hasGeneratedRoute = true;
        lastPlanMode = state.routeResult.source === "smart" ? "smart" : "manual";
        state.loading = false;
        state.error = null;
        persistAndPaint();
      }
      if (event === "focus_entity") {
        focusPersonId = data.personId || "";
        focusStopId = data.stopId || "";
        applyFocusHighlight();
      }
      if (event === "done") {
        assistantMessage.streaming = false;
        assistantMessage.status = "处理完成";
        assistantMessage.elapsedSec = assistantMessage.startedAt ? Math.max(0, Math.floor((Date.now() - assistantMessage.startedAt) / 1000)) : assistantMessage.elapsedSec;
        assistantMessage.source = data.source || "model";
        stopChatTicker();
        renderChat();
      }
      if (event === "error") {
        assistantMessage.streaming = false;
        assistantMessage.status = "请求过量";
        assistantMessage.elapsedSec = assistantMessage.startedAt ? Math.max(0, Math.floor((Date.now() - assistantMessage.startedAt) / 1000)) : assistantMessage.elapsedSec;
        assistantMessage.content = `${assistantMessage.content.trim() ? `${assistantMessage.content.trim()}\n` : ""}${friendlyErrorMessage(
          data.error || "对话失败",
          "对话失败"
        )}`;
        assistantMessage.source = "fallback";
        stopChatTicker();
        renderChat();
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, handleEvent);
    }
    if (manifestChanged && !routeFreshAfterManifest) {
      assistantMessage.streaming = true;
      startChatTicker();
      updateAssistantProgress(assistantMessage, "正在根据新清单同步右侧路线");
      const syncMode: "manual" | "smart" = state.meetingPoints.length ? "manual" : lastPlanMode;
      const synced = await syncRouteFromManifest(syncMode, { showLoading: true });
      assistantMessage.streaming = false;
      stopChatTicker();
      updateAssistantProgress(assistantMessage, synced ? "右侧路线已同步" : "右侧路线需要补全信息后再生成");
    }
    if (timeConstraintChanged && !manifestChanged && !routeFreshAfterManifest && (hadRouteBeforeTimeConstraint || !validateInput(state.meetingPoints.length ? "manual" : lastPlanMode))) {
      assistantMessage.streaming = true;
      startChatTicker();
      updateAssistantProgress(assistantMessage, "正在按新的时间约束刷新右侧规划");
      const syncMode: "manual" | "smart" = state.meetingPoints.length ? "manual" : lastPlanMode;
      const synced = await syncRouteFromManifest(syncMode, { showLoading: true });
      assistantMessage.streaming = false;
      stopChatTicker();
      updateAssistantProgress(assistantMessage, synced ? "右侧时间已换算" : "右侧时间需要补全信息后再生成");
    }
    if (routeChangeRequest && !manifestChanged && !routeFreshAfterManifest && !timeConstraintChanged) {
      updateAssistantProgress(assistantMessage, "未收到可应用的清单修改");
      if (!assistantMessage.content.includes("左侧清单")) {
        assistantMessage.content += `${assistantMessage.content.trim() ? "\n" : ""}这次没有收到可应用到左侧清单的修改，所以右侧路线没有变化。请明确说“让A去B那里集合”“把某点分配给某司机”或“重新AI优化”。`;
      }
      renderChat();
    }
    if (!assistantMessage.content.trim()) {
      assistantMessage.content = assistantMessage.status === "处理完成" ? "处理完成，路线结果已更新到右侧。" : "没有收到可用回复。";
      if (assistantMessage.status !== "处理完成") assistantMessage.source = "fallback";
      renderChat();
    }
  } catch (error) {
    assistantMessage.streaming = false;
    assistantMessage.status = "请求过量";
    assistantMessage.elapsedSec = assistantMessage.startedAt ? Math.max(0, Math.floor((Date.now() - assistantMessage.startedAt) / 1000)) : assistantMessage.elapsedSec;
    assistantMessage.content = friendlyErrorMessage(error, "对话失败");
    assistantMessage.source = "fallback";
  } finally {
    assistantMessage.streaming = false;
    assistantMessage.elapsedSec = assistantMessage.startedAt ? Math.max(0, Math.floor((Date.now() - assistantMessage.startedAt) / 1000)) : assistantMessage.elapsedSec;
    stopChatTicker();
    chatBusy = false;
    chatInput.disabled = false;
    chatSendButton.disabled = false;
    planButton.disabled = false;
    smartPlanButton.disabled = false;
    updateChrome();
    renderChat();
  }
}

function requestSmartAiPlan() {
  const validationError = validateInput("smart");
  if (validationError) {
    patchState({ error: validationError, routeResult: null });
    return;
  }
  lastPlanMode = "smart";
  sendChatMessage("请根据当前行程清单生成 AI 规划，跳过手动集合点。请比较逐个接人、单集合点、多集合点和混合接人，并把最终集合点写入左侧清单。");
}

const citySuggestionsHost = document.querySelector<HTMLElement>("#citySuggestions")!;
let citySuggestTimer = 0;
let latestCityRequest = 0;

function renderCitySuggestions(query: string) {
  citySuggestionsHost.innerHTML = "";
  if (!query || query.length < 1) {
    citySuggestionsHost.classList.remove("open");
    return;
  }
  citySuggestionsHost.innerHTML = `<div class="suggestion-empty">搜索中</div>`;
  citySuggestionsHost.classList.add("open");
}

async function fetchCitySuggestions(keyword: string) {
  const params = new URLSearchParams({ keyword });
  const response = await fetch(`/api/city-suggest?${params.toString()}`);
  return (await response.json()) as string[];
}

cityInput.addEventListener("input", () => {
  state.city = cityInput.value.trim() || "深圳";
  saveState(state);
  window.clearTimeout(citySuggestTimer);
  const value = cityInput.value.trim();
  if (value.length < 1) {
    citySuggestionsHost.classList.remove("open");
    return;
  }
  renderCitySuggestions(value);
  citySuggestTimer = window.setTimeout(async () => {
    const requestId = Date.now();
    latestCityRequest = requestId;
    try {
      const cities = await fetchCitySuggestions(value);
      if (latestCityRequest !== requestId) return;
      citySuggestionsHost.innerHTML = "";
      if (!cities.length) {
        citySuggestionsHost.classList.remove("open");
        return;
      }
      for (const city of cities) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "suggestion-item";
        button.textContent = city;
        button.addEventListener("click", () => {
          cityInput.value = city;
          state.city = city;
          citySuggestionsHost.classList.remove("open");
          saveState(state);
        });
        citySuggestionsHost.append(button);
      }
      citySuggestionsHost.classList.add("open");
    } catch {
      if (latestCityRequest === requestId) {
        citySuggestionsHost.classList.remove("open");
      }
    }
  }, 200);
});

cityInput.addEventListener("blur", () => {
  window.setTimeout(() => citySuggestionsHost.classList.remove("open"), 160);
});

applySavedPanelWidths();
leftResizeHandle.addEventListener("pointerdown", (event) => startResize("left", event));
rightResizeHandle.addEventListener("pointerdown", (event) => startResize("right", event));
rightSplitter.addEventListener("pointerdown", startRightPanelResize);
planButton.addEventListener("click", () => planRoute("manual"));
smartPlanButton.addEventListener("click", requestSmartAiPlan);
welcomeCloseButton.addEventListener("click", () => {
  welcomeModal.classList.add("hidden");
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") welcomeModal.classList.add("hidden");
});
chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (chatInput.disabled) return;
  const message = chatInput.value.trim();
  if (!message) return;
  sendChatMessage(message);
});

renderDestination();
renderPeople();
renderMeetings();
persistAndPaint();
