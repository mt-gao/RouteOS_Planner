import type { ExecutionTimelineItem, MemberPlan, RoutePlan, RoutePlanResponse } from "../types";

function minutes(seconds: number) {
  return Math.round(seconds / 60);
}

function formatDuration(seconds = 0) {
  const min = minutes(seconds);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m} 分钟`;
  if (m === 0) return `${h} 小时`;
  return `${h} 小时 ${m} 分钟`;
}

function formatDistance(meters = 0) {
  if (meters < 1000) return `${Math.round(meters)} 米`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

function formatOffset(seconds = 0) {
  const min = minutes(seconds);
  if (min < 0) return `T-${Math.abs(min)} 分钟`;
  return `T+${min} 分钟`;
}

function planKindLabel(kind?: RoutePlanResponse["planKind"]) {
  if (kind === "direct_pickup") return "逐个接人";
  if (kind === "single_meeting") return "单集合点";
  if (kind === "multi_meeting") return "多集合点";
  if (kind === "hybrid_pickup") return "混合接人";
  if (kind === "multi_driver") return "多司机";
  return "推荐方案";
}

function modeLabel(mode: MemberPlan["suggestedMode"]) {
  if (mode === "public_transit") return "公共交通";
  if (mode === "wait_at_origin") return "原地等车";
  return "打车/接送";
}

function appendMetric(host: HTMLElement, label: string, value: string) {
  const item = document.createElement("div");
  item.innerHTML = `<small>${label}</small><strong>${value}</strong>`;
  host.append(item);
}

function renderCompactPlan(plan: RoutePlan, label: string) {
  const card = document.createElement("div");
  card.className = "alt-plan";
  card.innerHTML = `
    <span>${label}</span>
    <strong>${plan.driverName}开车</strong>
    <small>${formatDuration(plan.totalDurationSec)}，${formatDistance(plan.totalDistanceM)}，多绕 ${formatDuration(plan.detourDurationSec)}</small>
  `;
  return card;
}

function renderTimeline(items: ExecutionTimelineItem[]) {
  if (!items.length) return null;
  const section = document.createElement("section");
  section.className = "execution-section";
  section.innerHTML = `<h3>司机时间线</h3>`;
  const list = document.createElement("ol");
  list.className = "sequence-list timeline-list";
  for (const item of items) {
    if (item.type === "start") continue;
    const row = document.createElement("li");
    const boarding = item.boardingNames.length ? `上车：${item.boardingNames.join("、")}` : item.type === "destination" ? "抵达终点" : "无上车成员";
    row.innerHTML = `
      <strong>${formatOffset(item.arrivalOffsetSec)} ${item.stopName}</strong>
      <span>${boarding}。本段车程 ${formatDuration(item.driveDurationSec)}，${formatDistance(item.distanceM)}</span>
    `;
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderMemberPlans(memberPlans: MemberPlan[]) {
  if (!memberPlans.length) return null;
  const section = document.createElement("section");
  section.className = "member-plan-section";
  section.innerHTML = `<h3>成员出发建议</h3>`;
  const list = document.createElement("div");
  list.className = "member-plan-list";
  for (const plan of memberPlans) {
    const card = document.createElement("div");
    card.className = "member-plan-card";
    card.dataset.personPlanId = plan.personId;
    const latest =
      plan.suggestedMode === "wait_at_origin"
        ? `司机约 ${formatOffset(plan.boardOffsetSec)} 到`
        : `最晚 ${formatOffset(plan.latestDepartureOffsetSec)} 出发`;
    card.innerHTML = `
      <div>
        <strong>${plan.personName}</strong>
        <span>${modeLabel(plan.suggestedMode)}</span>
      </div>
      <p>${latest}，到 ${plan.pickupPointName} 上车。</p>
      <small>${plan.suggestion}</small>
    `;
    list.append(card);
  }
  section.append(list);
  return section;
}

function renderMeetingRoutes(result: RoutePlanResponse) {
  if (!result.meetingRoutes?.length || result.memberPlans?.length) return null;
  const section = document.createElement("section");
  section.className = "member-plan-section";
  section.innerHTML = `<h3>集合点交通建议</h3>`;
  const list = document.createElement("div");
  list.className = "member-plan-list";
  for (const meeting of result.meetingRoutes) {
    for (const member of meeting.members) {
      const card = document.createElement("div");
      card.className = "member-plan-card";
      card.dataset.personPlanId = member.personId;
      card.innerHTML = `
        <div>
          <strong>${member.personName}</strong>
          <span>${modeLabel(member.suggestedMode)}</span>
        </div>
        <p>前往 ${meeting.meetingPointName} 集合。</p>
        <small>${member.suggestion}</small>
      `;
      list.append(card);
    }
  }
  section.append(list);
  return section;
}

function renderWarnings(result: RoutePlanResponse) {
  if (!result.planWarnings?.length) return null;
  const section = document.createElement("section");
  section.className = "warning-section";
  section.innerHTML = `<h3>需要注意</h3>`;
  for (const warning of result.planWarnings) {
    const item = document.createElement("div");
    item.className = warning.level === "warning" ? "warning-row strong" : "warning-row";
    item.textContent = warning.message;
    section.append(item);
  }
  return section;
}

function renderSmartSummary(result: RoutePlanResponse) {
  const analysis = result.smartAnalysis;
  if (!analysis) return null;
  const section = document.createElement("section");
  section.className = "smart-analysis-block";
  const meetingCount = result.generatedMeetingPoints?.length || analysis.selectedMeetings?.length || (analysis.selectedMeeting ? 1 : 0);
  section.innerHTML = `
    <div class="smart-summary">
      <span>AI Route</span>
      <strong>${planKindLabel(result.planKind)}</strong>
      <p>${analysis.summary}</p>
    </div>
    <div class="metric-grid compact"></div>
  `;
  const metrics = section.querySelector<HTMLElement>(".metric-grid")!;
  appendMetric(metrics, "集合点", `${meetingCount} 个`);
  appendMetric(metrics, "逐个接人", formatDuration(analysis.baselineTotalDurationSec));
  appendMetric(metrics, "当前方案", formatDuration(result.best.totalDurationSec));
  appendMetric(metrics, "预计变化", formatDuration(Math.max(0, analysis.baselineTotalDurationSec - result.best.totalDurationSec)));

  const candidates = analysis.candidates || [];
  if (candidates.length > 1) {
    const title = document.createElement("h3");
    title.textContent = "候选点参考";
    section.append(title);
    for (const candidate of candidates.slice(0, 4)) {
      const row = document.createElement("div");
      row.className = analysis.selectedMeetings?.some((item) => item.meetingPointId === candidate.meetingPointId) ? "candidate-row selected" : "candidate-row";
      row.innerHTML = `
        <strong>${candidate.meetingPointName}</strong>
        <span>${candidate.reason || `${candidate.driverName} T+${minutes(candidate.gatherReadySec)} 到达`}</span>
      `;
      section.append(row);
    }
  }
  return section;
}

export function renderRouteResult(host: HTMLElement, result: RoutePlanResponse | null, error: string | null, loading: boolean) {
  host.innerHTML = "";

  if (loading) {
    host.innerHTML = `
      <div class="empty-result loading-result">
        <span>Calculating</span>
        <strong>正在计算路线</strong>
        <div class="skeleton-line wide"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
      </div>
    `;
    return;
  }

  if (error) {
    host.innerHTML = `<div class="error-box">${error}</div>`;
    return;
  }

  if (!result) {
    host.innerHTML = `
      <div class="empty-result">
        <span>Ready</span>
        <strong>等待生成路线</strong>
        <p>确认终点、人员坐标和至少一位开车人员后，这里会显示司机时间线、成员出发建议和集合点方案。</p>
      </div>
    `;
    return;
  }

  const title = document.createElement("div");
  title.className = "result-title";
  title.innerHTML = `
    <span>${result.source === "smart" ? "AI 执行方案" : result.mode === "multi-driver" ? "多司机分配方案" : "推荐方案"}</span>
    <strong>${planKindLabel(result.planKind)}</strong>
    <small>${result.best.driverName}${result.mode === "multi-driver" ? "" : "开车"}，${result.best.orderedPassengerNames.length ? `途经 ${result.best.orderedPassengerNames.join("、")}` : "直接前往终点"}</small>
  `;
  host.append(title);

  const metrics = document.createElement("div");
  metrics.className = "metric-grid";
  appendMetric(metrics, "总耗时", formatDuration(result.best.totalDurationSec));
  appendMetric(metrics, "总距离", formatDistance(result.best.totalDistanceM));
  appendMetric(metrics, "多绕路", formatDuration(result.best.detourDurationSec));
  appendMetric(metrics, "完成接人", formatOffset(Math.max(0, ...(result.memberPlans || []).map((plan) => plan.boardOffsetSec))));
  host.append(metrics);

  const smartSummary = renderSmartSummary(result);
  if (smartSummary) host.append(smartSummary);

  const warnings = renderWarnings(result);
  if (warnings) host.append(warnings);

  const timeline = renderTimeline(result.executionTimeline || []);
  if (timeline) host.append(timeline);

  const memberPlans = renderMemberPlans(result.memberPlans || []);
  if (memberPlans) host.append(memberPlans);

  const meetingRoutes = renderMeetingRoutes(result);
  if (meetingRoutes) host.append(meetingRoutes);

  if (!result.executionTimeline?.length) {
    const details = result.mode === "multi-driver" ? result.driverRoutes : [result.best];
    for (const route of details) host.append(renderCompactPlan(route, `${route.driverName}路线`));
  }

  const alternatives = result.alternatives || [];
  if (alternatives.length) {
    const altTitle = document.createElement("h3");
    altTitle.textContent = "备选方案";
    host.append(altTitle);
    alternatives.forEach((plan, index) => {
      host.append(renderCompactPlan(plan, index === 0 ? "少绕路/少等待" : "备选"));
    });
  }
}
