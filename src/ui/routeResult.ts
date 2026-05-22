import type { RoutePlan, RoutePlanResponse } from "../types";

function minutes(seconds: number) {
  return Math.round(seconds / 60);
}

function formatDuration(seconds: number) {
  const min = minutes(seconds);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m} 分钟`;
  if (m === 0) return `${h} 小时`;
  return `${h} 小时 ${m} 分钟`;
}

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} 米`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

function formatEta(startIso: string, offsetSec: number) {
  const date = new Date(new Date(startIso).getTime() + offsetSec * 1000);
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function renderCompactPlan(plan: RoutePlan, label: string) {
  const card = document.createElement("div");
  card.className = "alt-plan";
  card.innerHTML = `
    <span>${label}</span>
    <strong>${plan.driverName}开车</strong>
    <small>${formatDuration(plan.totalDurationSec)} · ${formatDistance(plan.totalDistanceM)} · 多绕 ${formatDuration(plan.detourDurationSec)}</small>
  `;
  return card;
}

function renderPlanDetail(plan: RoutePlan, generatedAt: string) {
  const section = document.createElement("section");
  section.className = "driver-route-block";
  section.innerHTML = `<h3>${plan.driverName}路线</h3>`;

  const metrics = document.createElement("div");
  metrics.className = "metric-grid compact";
  metrics.innerHTML = `
    <div><small>耗时</small><strong>${formatDuration(plan.totalDurationSec)}</strong></div>
    <div><small>距离</small><strong>${formatDistance(plan.totalDistanceM)}</strong></div>
  `;
  section.append(metrics);

  const sequence = document.createElement("ol");
  sequence.className = "sequence-list";
  const first = document.createElement("li");
  first.innerHTML = `<strong>${plan.driverName}</strong><span>从出发点发车</span>`;
  sequence.append(first);

  for (const segment of plan.segments) {
    const item = document.createElement("li");
    const isDest = segment.toId === "dest";
    item.innerHTML = `
      <strong>${formatEta(generatedAt, segment.arrivalOffsetSec)}</strong>
      <span>${isDest ? "到达终点" : `接 ${segment.toName}`} · ${formatDuration(segment.durationSec)} · ${formatDistance(segment.distanceM)}</span>
    `;
    sequence.append(item);
  }
  section.append(sequence);
  return section;
}

function renderSmartAnalysis(result: RoutePlanResponse) {
  const analysis = result.smartAnalysis;
  if (!analysis?.selectedMeeting) return null;
  const section = document.createElement("section");
  section.className = "smart-analysis-block";
  const selected = analysis.selectedMeeting;
  section.innerHTML = `
    <div class="smart-summary">
      <span>AI Route</span>
      <strong>${selected.meetingPointName}</strong>
      <p>${analysis.summary}</p>
    </div>
    <div class="metric-grid compact">
      <div><small>逐个接人</small><strong>${formatDuration(analysis.baselineTotalDurationSec)}</strong></div>
      <div><small>预计节省</small><strong>${formatDuration(Math.max(0, selected.savedVsBaselineSec))}</strong></div>
      <div><small>司机到集合点</small><strong>${formatDuration(selected.driverToMeetingSec)}</strong></div>
      <div><small>集合后到终点</small><strong>${formatDuration(selected.meetingToDestinationSec)}</strong></div>
    </div>
  `;

  if (analysis.candidates.length > 1) {
    const title = document.createElement("h3");
    title.textContent = "候选集合点";
    section.append(title);
    for (const candidate of analysis.candidates.slice(0, 4)) {
      const row = document.createElement("div");
      row.className = candidate.meetingPointId === selected.meetingPointId ? "candidate-row selected" : "candidate-row";
      row.innerHTML = `
        <strong>${candidate.meetingPointName}</strong>
        <span>${formatDuration(candidate.totalDurationSec)} · ${
          candidate.savedVsBaselineSec > 0 ? `节省 ${formatDuration(candidate.savedVsBaselineSec)}` : "不比逐个接更快"
        }</span>
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
        <p>确认终点、人员地址和至少一位开车人员后，这里会显示推荐司机、接人顺序和集合路线。</p>
      </div>
    `;
    return;
  }

  const best = result.best;
  const title = document.createElement("div");
  title.className = "result-title";
  title.innerHTML = `
    <span>${result.source === "smart" ? "AI 智能集合方案" : result.mode === "multi-driver" ? "多司机分配方案" : "推荐方案"}</span>
    <strong>${best.driverName}${result.mode === "multi-driver" ? "" : "开车"}</strong>
    <small>${best.orderedPassengerNames.length ? `接 ${best.orderedPassengerNames.join("、")}` : "直接前往终点"}</small>
  `;
  host.append(title);

  const metrics = document.createElement("div");
  metrics.className = "metric-grid";
  metrics.innerHTML = `
    <div><small>总耗时</small><strong>${formatDuration(best.totalDurationSec)}</strong></div>
    <div><small>总距离</small><strong>${formatDistance(best.totalDistanceM)}</strong></div>
    <div><small>多绕路</small><strong>${formatDuration(best.detourDurationSec)}</strong></div>
    <div><small>最终到达</small><strong>${formatEta(result.generatedAt, best.totalDurationSec)}</strong></div>
  `;
  host.append(metrics);

  const smartAnalysis = renderSmartAnalysis(result);
  if (smartAnalysis) host.append(smartAnalysis);

  if (result.mode === "multi-driver") {
    for (const route of result.driverRoutes) {
      host.append(renderPlanDetail(route, result.generatedAt));
    }
  } else {
    host.append(renderPlanDetail(best, result.generatedAt));
  }

  const why = document.createElement("div");
  why.className = "why-box";
  const firstPassenger = best.orderedPassengerNames[0];
  why.textContent =
    result.mode === "multi-driver"
      ? `已按手动分配把点位拆给不同司机；总耗时按最晚到达司机估算，总距离为各司机路线合计。`
      : firstPassenger
        ? `这组顺序在当前候选司机中总耗时最低。先接 ${firstPassenger} 后继续向终点推进，相对 ${best.driverName} 直达终点多约 ${formatDuration(best.detourDurationSec)}。`
        : `${best.driverName} 可直接前往终点。`;
  host.append(why);

  if (result.meetingRoutes.length) {
    const meetingTitle = document.createElement("h3");
    meetingTitle.textContent = "集合路线";
    host.append(meetingTitle);
    for (const meeting of result.meetingRoutes) {
      const card = document.createElement("div");
      card.className = "alt-plan";
      card.innerHTML = `<span>${meeting.meetingPointName}</span>${meeting.members
        .map(
          (member) => `
            <strong>${member.personName}：${member.suggestedMode === "public_transit" ? "公共交通" : "打车/接送"}</strong>
            <small>${member.suggestion}</small>
          `
        )
        .join("")}`;
      host.append(card);
    }
  }

  if (result.mode !== "multi-driver" && result.driverCandidates.length > 1) {
    const driverTitle = document.createElement("h3");
    driverTitle.textContent = "司机对比";
    host.append(driverTitle);
    for (const [index, plan] of result.driverCandidates.entries()) {
      host.append(renderCompactPlan(plan, index === 0 ? "全局较优" : "候选"));
    }
  }

  if (result.alternatives.length) {
    const altTitle = document.createElement("h3");
    altTitle.textContent = "备选方案";
    host.append(altTitle);
    result.alternatives.forEach((plan, index) => {
      host.append(renderCompactPlan(plan, index === 0 ? "少绕路/等待" : "备选"));
    });
  }
}
