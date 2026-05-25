import { AmapClient } from "./amapClient";
import { planPickupStops } from "./planner";
import type {
  DestinationInput,
  ExecutionTimelineItem,
  LocationPoint,
  MatrixResult,
  MeetingRouteSummary,
  MemberPlan,
  PersonInput,
  PickupStopInput,
  PlanKind,
  PlanWarning,
  Point,
  RoutePlan,
  SmartMemberRoute,
  SmartRouteAnalysis,
  SmartRouteCandidate,
  TransitRouteDetail
} from "./types";

type SmartPlanInput = {
  people: PersonInput[];
  destination: DestinationInput;
  city: string;
};

type RoutePlanWithDetail = RoutePlan & { routeDetail?: any };

type PassengerGroup = {
  id: string;
  members: PersonInput[];
};

type MeetingCandidate = LocationPoint & {
  groupId: string;
  memberIds: string[];
  memberNames: string[];
};

type ScenarioStop = PickupStopInput & {
  meetingCandidate?: MeetingCandidate;
};

type Scenario = {
  id: string;
  kind: PlanKind;
  label: string;
  stops: ScenarioStop[];
  meetingCandidates: MeetingCandidate[];
};

type EvaluatedScenario = {
  scenario: Scenario;
  best: RoutePlanWithDetail;
  driverRoutes: RoutePlanWithDetail[];
  alternatives: RoutePlan[];
  driverCandidates: RoutePlan[];
  executionTimeline: ExecutionTimelineItem[];
  memberPlans: MemberPlan[];
  meetingRoutes: MeetingRouteSummary[];
  smartCandidates: SmartRouteCandidate[];
  generatedMeetingPoints: Array<{
    id: string;
    name: string;
    address: string;
    location: Point;
    memberIds: string[];
    assignedDriverId?: string;
  }>;
  warnings: PlanWarning[];
  score: number;
};

const MAX_CANDIDATE_GROUPS = 3;
const MAX_CANDIDATES_PER_GROUP = 2;
const MAX_SCENARIOS_TO_SCORE = 14;

function minutes(seconds: number) {
  return Math.round(seconds / 60);
}

function formatDuration(seconds: number) {
  const min = minutes(seconds);
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

function key(fromId: string, toId: string) {
  return `${fromId}:${toId}`;
}

function getLeg(matrix: MatrixResult, fromId: string, toId: string) {
  const durationSec = matrix.durations[key(fromId, toId)];
  const distanceM = matrix.distances[key(fromId, toId)];
  if (!Number.isFinite(durationSec) || !Number.isFinite(distanceM)) {
    throw new Error(`缺少 ${fromId} 到 ${toId} 的路线矩阵数据`);
  }
  return { durationSec, distanceM };
}

function centroid(points: Point[]): Point {
  return {
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length
  };
}

function distanceSq(a: Point, b: Point) {
  const lng = a.lng - b.lng;
  const lat = a.lat - b.lat;
  return lng * lng + lat * lat;
}

function uniqueById(points: LocationPoint[]) {
  const seen = new Set<string>();
  const result: LocationPoint[] = [];
  for (const point of points) {
    const id = point.id || `${point.name}-${point.lng.toFixed(5)}-${point.lat.toFixed(5)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(point);
  }
  return result;
}

function uniquePoints(points: LocationPoint[]) {
  const seen = new Set<string>();
  const result: LocationPoint[] = [];
  for (const point of points) {
    if (seen.has(point.id)) continue;
    seen.add(point.id);
    result.push(point);
  }
  return result;
}

function groupSignature(group: PassengerGroup) {
  return group.members.map((member) => member.id).sort().join("|");
}

function candidateLooksUsable(point: LocationPoint) {
  if (!point.name.trim()) return false;
  return !/出入口|入口|出口|[A-Z]\d?口/i.test(point.name);
}

function toDirectStop(person: PersonInput): ScenarioStop {
  return {
    id: person.id,
    name: person.name,
    address: person.address,
    location: person.location,
    kind: "person"
  };
}

function toMeetingStop(candidate: MeetingCandidate): ScenarioStop {
  return {
    id: candidate.id,
    name: candidate.name,
    address: candidate.address || candidate.name,
    location: { lng: candidate.lng, lat: candidate.lat },
    kind: "meeting",
    memberIds: candidate.memberIds,
    memberNames: candidate.memberNames,
    meetingCandidate: candidate
  };
}

function buildPassengerGroups(passengers: PersonInput[]) {
  const groups: PassengerGroup[] = [];
  const pushGroup = (id: string, members: PersonInput[]) => {
    if (members.length < 2) return;
    const group = { id, members };
    const signature = groupSignature(group);
    if (!groups.some((item) => groupSignature(item) === signature)) groups.push(group);
  };

  pushGroup("all", passengers);

  if (passengers.length >= 4) {
    const lngSpread = Math.max(...passengers.map((p) => p.location.lng)) - Math.min(...passengers.map((p) => p.location.lng));
    const latSpread = Math.max(...passengers.map((p) => p.location.lat)) - Math.min(...passengers.map((p) => p.location.lat));
    const sorted = [...passengers].sort((a, b) =>
      lngSpread >= latSpread ? a.location.lng - b.location.lng : a.location.lat - b.location.lat
    );
    const mid = Math.ceil(sorted.length / 2);
    pushGroup("cluster-a", sorted.slice(0, mid));
    pushGroup("cluster-b", sorted.slice(mid));
  }

  const pairs = [];
  for (let i = 0; i < passengers.length; i += 1) {
    for (let j = i + 1; j < passengers.length; j += 1) {
      pairs.push({
        members: [passengers[i], passengers[j]],
        distance: distanceSq(passengers[i].location, passengers[j].location)
      });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance);
  for (const [index, pair] of pairs.slice(0, 3).entries()) {
    pushGroup(`pair-${index + 1}`, pair.members);
  }

  return groups.slice(0, MAX_CANDIDATE_GROUPS);
}

async function getMeetingCandidates(amap: AmapClient, input: SmartPlanInput, group: PassengerGroup): Promise<MeetingCandidate[]> {
  const center = centroid(group.members.map((member) => member.location));
  const memberOrigins: LocationPoint[] = group.members.slice(0, 2).map((member) => ({
    id: `home-${member.id}`,
    name: `${member.name}所在地`,
    address: member.address,
    lng: member.location.lng,
    lat: member.location.lat
  }));
  const metro = await amap
    .around(center, { city: input.city, types: "150500", radius: 10000, offset: 6 })
    .catch(() => [] as LocationPoint[]);
  const malls = await amap
    .around(center, { city: input.city, types: "060100", radius: 9000, offset: 3 })
    .catch(() => [] as LocationPoint[]);

  return uniqueById([...memberOrigins, ...metro.filter(candidateLooksUsable), ...malls.filter(candidateLooksUsable)])
    .slice(0, MAX_CANDIDATES_PER_GROUP)
    .map((point, index) => ({
      ...point,
      id: `meeting-${group.id}-${point.id || index}`,
      groupId: group.id,
      memberIds: group.members.map((member) => member.id),
      memberNames: group.members.map((member) => member.name)
    }));
}

function combine<T>(lists: T[][]): T[][] {
  if (!lists.length) return [[]];
  const [head, ...tail] = lists;
  const rest = combine(tail);
  return head.flatMap((item) => rest.map((items) => [item, ...items]));
}

function buildScenarios(passengers: PersonInput[], candidatesByGroup: Map<string, MeetingCandidate[]>) {
  const scenarios: Scenario[] = [];
  const directStops = passengers.map(toDirectStop);
  scenarios.push({ id: "direct", kind: "direct_pickup", label: "逐个接人", stops: directStops, meetingCandidates: [] });

  const all = candidatesByGroup.get("all") || [];
  for (const candidate of all) {
    scenarios.push({
      id: `single-${candidate.id}`,
      kind: "single_meeting",
      label: "单集合点",
      stops: [toMeetingStop(candidate)],
      meetingCandidates: [candidate]
    });
  }

  const splitGroups = ["cluster-a", "cluster-b"].map((id) => candidatesByGroup.get(id) || []);
  if (splitGroups.every((items) => items.length)) {
    for (const candidates of combine(splitGroups).slice(0, 6)) {
      scenarios.push({
        id: `multi-${candidates.map((candidate) => candidate.id).join("-")}`,
        kind: "multi_meeting",
        label: "多集合点",
        stops: candidates.map(toMeetingStop),
        meetingCandidates: candidates
      });
    }
  }

  const pairGroups = [...candidatesByGroup.entries()].filter(([id]) => id.startsWith("pair-")).slice(0, 2);
  for (const [, candidates] of pairGroups) {
    for (const candidate of candidates.slice(0, 2)) {
      const grouped = new Set(candidate.memberIds);
      scenarios.push({
        id: `hybrid-${candidate.id}`,
        kind: "hybrid_pickup",
        label: "混合接人",
        stops: [toMeetingStop(candidate), ...passengers.filter((person) => !grouped.has(person.id)).map(toDirectStop)],
        meetingCandidates: [candidate]
      });
    }
  }

  return scenarios.slice(0, MAX_SCENARIOS_TO_SCORE);
}

function buildSmartMemberRouteFromMatrix(member: PersonInput, candidate: MeetingCandidate, matrix: MatrixResult): SmartMemberRoute {
  const taxi = getLeg(matrix, member.id, candidate.id);
  return {
    personId: member.id,
    personName: member.name,
    durationSec: taxi.durationSec,
    distanceM: taxi.distanceM,
    suggestedMode: "taxi",
    suggestion: `建议打车或接送到 ${candidate.name}，约 ${formatDuration(taxi.durationSec)}，${(taxi.distanceM / 1000).toFixed(1)} 公里。`
  };
}

async function enrichMemberRoute(
  amap: AmapClient,
  input: SmartPlanInput,
  member: PersonInput,
  candidate: MeetingCandidate,
  fallback: SmartMemberRoute
): Promise<SmartMemberRoute> {
  return fallback;
}

function stopById(stops: ScenarioStop[], id: string) {
  return stops.find((stop) => stop.id === id);
}

function buildTimeline(routes: RoutePlan[], stops: ScenarioStop[]): ExecutionTimelineItem[] {
  const items: ExecutionTimelineItem[] = [];
  for (const route of routes) {
    items.push({
      type: "start",
      driverId: route.driverId,
      driverName: route.driverName,
      stopId: route.driverId,
      stopName: `${route.driverName}出发`,
      arrivalOffsetSec: 0,
      departOffsetSec: 0,
      driveDurationSec: 0,
      waitDurationSec: 0,
      distanceM: 0,
      boardingNames: []
    });
    for (const segment of route.segments) {
      const stop = stopById(stops, segment.toId);
      items.push({
        type: segment.toId === "dest" ? "destination" : stop?.kind === "meeting" ? "meeting" : "pickup",
        driverId: route.driverId,
        driverName: route.driverName,
        stopId: segment.toId,
        stopName: segment.toName,
        arrivalOffsetSec: segment.arrivalOffsetSec,
        departOffsetSec: segment.arrivalOffsetSec,
        driveDurationSec: segment.durationSec,
        waitDurationSec: 0,
        distanceM: segment.distanceM,
        boardingNames: stop?.kind === "meeting" ? stop.memberNames || [] : stop ? [stop.name] : []
      });
    }
  }
  return items.sort((a, b) => a.arrivalOffsetSec - b.arrivalOffsetSec || a.driverName.localeCompare(b.driverName, "zh-CN"));
}

function routeByStop(routes: RoutePlan[], stopId: string) {
  return routes.find((route) => route.segments.some((segment) => segment.toId === stopId));
}

function arrivalOffsetForStop(routes: RoutePlan[], stopId: string) {
  const route = routeByStop(routes, stopId);
  const segment = route?.segments.find((item) => item.toId === stopId);
  if (!route || !segment) return null;
  return { route, offsetSec: segment.arrivalOffsetSec };
}

function memberPlanText(memberRoute: SmartMemberRoute, latestDepartureOffsetSec: number) {
  const prefix =
    latestDepartureOffsetSec < 0
      ? `需要在司机出发前 ${formatDuration(Math.abs(latestDepartureOffsetSec))} 出发`
      : `最晚 T+${minutes(latestDepartureOffsetSec)} 出发`;
  return `${prefix}，${memberRoute.suggestion}`;
}

function buildMemberPlans(
  input: SmartPlanInput,
  scenario: Scenario,
  routes: RoutePlan[],
  matrix: MatrixResult,
  enrichedRoutes = new Map<string, SmartMemberRoute>()
) {
  const memberPlans: MemberPlan[] = [];
  const meetingRoutes: MeetingRouteSummary[] = [];
  const smartCandidates: SmartRouteCandidate[] = [];
  const warnings: PlanWarning[] = [];
  const passengers = input.people.filter((person) => !person.hasCar);

  for (const stop of scenario.stops) {
    const arrival = arrivalOffsetForStop(routes, stop.id);
    if (!arrival) continue;
    if (stop.kind === "meeting" && stop.meetingCandidate) {
      const members: SmartMemberRoute[] = [];
      for (const memberId of stop.memberIds || []) {
        const member = passengers.find((person) => person.id === memberId);
        if (!member) continue;
        const mapKey = `${member.id}:${stop.id}`;
        const memberRoute = enrichedRoutes.get(mapKey) || buildSmartMemberRouteFromMatrix(member, stop.meetingCandidate, matrix);
        const latestDepartureOffsetSec = arrival.offsetSec - memberRoute.durationSec;
        if (latestDepartureOffsetSec < 0) {
          warnings.push({
            level: "warning",
            personId: member.id,
            stopId: stop.id,
            message: `${member.name} 到 ${stop.name} 需要 ${formatDuration(memberRoute.durationSec)}，必须比司机早出发 ${formatDuration(Math.abs(latestDepartureOffsetSec))}。`
          });
        }
        memberPlans.push({
          personId: member.id,
          personName: member.name,
          pickupPointId: stop.id,
          pickupPointName: stop.name,
          pickupPointAddress: stop.address,
          pickupPointKind: "meeting",
          assignedDriverId: arrival.route.driverId,
          assignedDriverName: arrival.route.driverName,
          suggestedMode: memberRoute.suggestedMode,
          travelDurationSec: memberRoute.durationSec,
          distanceM: memberRoute.distanceM,
          latestDepartureOffsetSec,
          arrivalOffsetSec: arrival.offsetSec,
          boardOffsetSec: arrival.offsetSec,
          waitDurationSec: 0,
          suggestion: memberPlanText(memberRoute, latestDepartureOffsetSec),
          transit: memberRoute.transit
        });
        members.push(memberRoute);
      }
      meetingRoutes.push({ meetingPointId: stop.id, meetingPointName: stop.name, members });
      const driverToMeeting = getLeg(matrix, arrival.route.driverId, stop.id);
      const meetingToDest = getLeg(matrix, stop.id, "dest");
      const baselineTotalDurationSec = arrival.route.totalDurationSec;
      smartCandidates.push({
        meetingPointId: stop.id,
        meetingPointName: stop.name,
        address: stop.address,
        location: stop.location,
        driverId: arrival.route.driverId,
        driverName: arrival.route.driverName,
        driverToMeetingSec: driverToMeeting.durationSec,
        driverToMeetingDistanceM: driverToMeeting.distanceM,
        meetingToDestinationSec: meetingToDest.durationSec,
        meetingToDestinationDistanceM: meetingToDest.distanceM,
        gatherReadySec: arrival.offsetSec,
        totalDurationSec: arrival.route.totalDurationSec,
        totalDistanceM: arrival.route.totalDistanceM,
        savedVsBaselineSec: 0,
        members,
        reason: `${stop.name} 承接 ${members.map((member) => member.personName).join("、")}，司机 T+${minutes(arrival.offsetSec)} 到达。`
      });
    } else if (stop.kind === "person") {
      const person = passengers.find((item) => item.id === stop.id);
      if (!person) continue;
      memberPlans.push({
        personId: person.id,
        personName: person.name,
        pickupPointId: person.id,
        pickupPointName: person.name,
        pickupPointAddress: person.address,
        pickupPointKind: "origin",
        assignedDriverId: arrival.route.driverId,
        assignedDriverName: arrival.route.driverName,
        suggestedMode: "wait_at_origin",
        travelDurationSec: 0,
        distanceM: 0,
        latestDepartureOffsetSec: arrival.offsetSec,
        arrivalOffsetSec: arrival.offsetSec,
        boardOffsetSec: arrival.offsetSec,
        waitDurationSec: 0,
        suggestion: `在原出发点等车，${arrival.route.driverName} 预计 T+${minutes(arrival.offsetSec)} 到。`
      });
    }
  }

  return { memberPlans, meetingRoutes, smartCandidates, warnings };
}

function passengerPenalty(memberPlans: MemberPlan[]) {
  const total = memberPlans.reduce((sum, plan) => {
    const travelWeight = plan.suggestedMode === "public_transit" ? 0.58 : 0.76;
    const travelPenalty = plan.suggestedMode === "wait_at_origin" ? 0 : plan.travelDurationSec * travelWeight;
    const earlyPenalty = plan.latestDepartureOffsetSec < 0 ? Math.abs(plan.latestDepartureOffsetSec) * 0.25 : 0;
    const distancePenalty = plan.suggestedMode === "taxi" ? Math.max(0, plan.distanceM - 6000) * 0.08 : 0;
    const transitWalkPenalty = plan.suggestedMode === "public_transit" ? Math.max(0, plan.distanceM - 1400) * 0.14 : 0;
    return sum + travelPenalty + earlyPenalty + distancePenalty + transitWalkPenalty;
  }, 0);
  const worstTravel = Math.max(0, ...memberPlans.map((plan) => (plan.suggestedMode === "wait_at_origin" ? 0 : plan.travelDurationSec)));
  return total + Math.max(0, worstTravel - 2400) * 0.9;
}

async function attachRouteDetails(
  amap: AmapClient,
  input: SmartPlanInput,
  routes: RoutePlan[],
  stops: ScenarioStop[]
): Promise<RoutePlanWithDetail[]> {
  const stopsById = new Map(stops.map((stop) => [stop.id, stop]));
  const results = await Promise.all(
    routes.map(async (route) => {
      const driver = input.people.find((person) => person.id === route.driverId);
      if (!driver) return route;
      const waypoints = route.orderedPassengerIds
        .map((id) => stopsById.get(id))
        .filter(Boolean)
        .map((stop) => stop!.location);
      const routeDetail = await amap.routeDetail(driver.location, waypoints, input.destination.location).catch(() => undefined);
      return { ...route, routeDetail };
    })
  );
  return results;
}

async function evaluateScenario(input: SmartPlanInput, scenario: Scenario, matrix: MatrixResult): Promise<EvaluatedScenario | null> {
  const drivers = input.people.filter((person) => person.hasCar);
  const planned = planPickupStops(drivers, scenario.stops, input.destination, matrix);
  const rawRoutes = planned.driverRoutes.length ? planned.driverRoutes : [planned.best];
  const routeForSummary = planned.mode === "multi-driver" ? rawRoutes : [planned.best];
  const draftTiming = buildMemberPlans(input, scenario, routeForSummary, matrix);
  const score =
    planned.best.totalDurationSec +
    passengerPenalty(draftTiming.memberPlans) +
    scenario.meetingCandidates.length * 210 +
    scenario.stops.length * 45;

  return {
    scenario,
    best: planned.best,
    driverRoutes: rawRoutes,
    alternatives: planned.alternatives,
    driverCandidates: planned.driverCandidates,
    executionTimeline: buildTimeline(routeForSummary, scenario.stops),
    memberPlans: draftTiming.memberPlans,
    meetingRoutes: draftTiming.meetingRoutes,
    smartCandidates: draftTiming.smartCandidates,
    generatedMeetingPoints: [],
    warnings: draftTiming.warnings,
    score
  };
}

async function enrichSelectedScenario(amap: AmapClient, input: SmartPlanInput, evaluated: EvaluatedScenario, matrix: MatrixResult) {
  const enrichedRoutes = new Map<string, SmartMemberRoute>();
  for (const stop of evaluated.scenario.stops) {
    if (stop.kind !== "meeting" || !stop.meetingCandidate) continue;
    for (const memberId of stop.memberIds || []) {
      const member = input.people.find((person) => person.id === memberId);
      if (!member) continue;
      const fallback = buildSmartMemberRouteFromMatrix(member, stop.meetingCandidate, matrix);
      const enriched = await enrichMemberRoute(amap, input, member, stop.meetingCandidate, fallback);
      enrichedRoutes.set(`${member.id}:${stop.id}`, enriched);
    }
  }

  const detailedRoutes = await attachRouteDetails(amap, input, evaluated.driverRoutes, evaluated.scenario.stops);
  const routesForTiming = evaluated.best.driverId === "multi" ? detailedRoutes : [detailedRoutes[0] || evaluated.best];
  const timing = buildMemberPlans(input, evaluated.scenario, routesForTiming, matrix, enrichedRoutes);
  const generatedMeetingPoints = evaluated.scenario.stops
    .filter((stop) => stop.kind === "meeting")
    .map((stop) => {
      const assignedRoute = routeByStop(routesForTiming, stop.id);
      return {
        id: stop.id,
        name: stop.name,
        address: stop.address,
        location: stop.location,
        memberIds: stop.memberIds || [],
        assignedDriverId: assignedRoute?.driverId
      };
    });

  return {
    ...evaluated,
    best: evaluated.best.driverId === "multi" ? evaluated.best : detailedRoutes[0] || evaluated.best,
    driverRoutes: detailedRoutes,
    executionTimeline: buildTimeline(routesForTiming, evaluated.scenario.stops),
    memberPlans: timing.memberPlans,
    meetingRoutes: timing.meetingRoutes,
    smartCandidates: timing.smartCandidates,
    generatedMeetingPoints,
    warnings: timing.warnings,
    score: evaluated.score + passengerPenalty(timing.memberPlans) * 0.25
  };
}

function buildAnalysis(selected: EvaluatedScenario, baseline: RoutePlan, ranked: EvaluatedScenario[]): SmartRouteAnalysis {
  const saved = baseline.totalDurationSec - selected.best.totalDurationSec;
  const summary =
    selected.scenario.kind === "direct_pickup"
      ? `当前最稳方案是司机按顺序逐个接人，全程约 ${formatDuration(selected.best.totalDurationSec)}。`
      : `${selected.scenario.label}方案约 ${formatDuration(selected.best.totalDurationSec)}，${saved > 0 ? `比逐个接人快 ${formatDuration(saved)}` : "不一定比逐个接人更快，但乘客集合成本更可控"}。`;
  return {
    baselineTotalDurationSec: baseline.totalDurationSec,
    baselineDriverName: baseline.driverName,
    baselineOrderNames: baseline.orderedPassengerNames,
    selectedMeeting: selected.smartCandidates[0],
    selectedMeetings: selected.smartCandidates,
    candidates: ranked.flatMap((item) => item.smartCandidates.slice(0, 1)).slice(0, 5),
    summary,
    caveats: [
      "AI 规划已比较逐个接人、单集合点、多集合点和混合接人。",
      "成员最晚出发时间按司机到达该上车点倒推，不再默认所有人 T+0 同时出发。",
      "公共交通与驾车时间来自高德当前估算，停车和临时等人仍需现场确认。"
    ]
  };
}

export async function planSmartRoute(amap: AmapClient, input: SmartPlanInput) {
  const drivers = input.people.filter((person) => person.hasCar);
  const passengers = input.people.filter((person) => !person.hasCar);
  if (!drivers.length) throw new Error("请至少勾选 1 位开车人员");
  if (!passengers.length) throw new Error("智能规划需要至少 1 位乘客");

  const groups = buildPassengerGroups(passengers);
  const candidatesByGroup = new Map<string, MeetingCandidate[]>();
  for (const group of groups) {
    candidatesByGroup.set(group.id, await getMeetingCandidates(amap, input, group));
  }

  const baselineScenario: Scenario = {
    id: "direct",
    kind: "direct_pickup",
    label: "逐个接人",
    stops: passengers.map(toDirectStop),
    meetingCandidates: []
  };
  const scenarios = buildScenarios(passengers, candidatesByGroup);
  if (!scenarios.some((scenario) => scenario.id === baselineScenario.id)) scenarios.unshift(baselineScenario);

  const matrix = await amap.matrix(
    uniquePoints([
      ...input.people.map((person) => ({ id: person.id, name: person.name, lng: person.location.lng, lat: person.location.lat })),
      ...scenarios.flatMap((scenario) =>
        scenario.stops.map((stop) => ({ id: stop.id, name: stop.name, lng: stop.location.lng, lat: stop.location.lat }))
      ),
      { id: "dest", name: input.destination.name, lng: input.destination.location.lng, lat: input.destination.location.lat }
    ])
  );
  const baseline = planPickupStops(drivers, baselineScenario.stops, input.destination, matrix).best;

  const evaluated: EvaluatedScenario[] = [];
  for (const scenario of scenarios) {
    const result = await evaluateScenario(input, scenario, matrix).catch(() => null);
    if (result) evaluated.push(result);
  }
  if (!evaluated.length) throw new Error("高德没有返回可用的智能规划候选");

  const rankedDraft = evaluated.sort((a, b) => a.score - b.score || a.best.totalDurationSec - b.best.totalDurationSec);
  const enriched = await enrichSelectedScenario(amap, input, rankedDraft[0], matrix);
  const ranked = [enriched, ...rankedDraft.slice(1)];
  const selected = enriched;
  const analysis = buildAnalysis(selected, baseline, ranked);

  return {
    generatedAt: new Date().toISOString(),
    mode: selected.best.driverId === "multi" ? ("multi-driver" as const) : ("single-driver" as const),
    source: "smart" as const,
    planKind: selected.scenario.kind,
    best: selected.best,
    alternatives: selected.alternatives,
    driverCandidates: selected.driverCandidates,
    driverRoutes: selected.driverRoutes,
    meetingRoutes: selected.meetingRoutes,
    executionTimeline: selected.executionTimeline,
    memberPlans: selected.memberPlans,
    planWarnings: selected.warnings,
    generatedMeetingPoints: selected.generatedMeetingPoints,
    smartAnalysis: analysis
  };
}
