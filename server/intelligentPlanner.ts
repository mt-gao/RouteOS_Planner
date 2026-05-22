import { AmapClient } from "./amapClient";
import { planPickupRoutes } from "./planner";
import type {
  DestinationInput,
  LocationPoint,
  MatrixResult,
  MeetingRouteSummary,
  PersonInput,
  Point,
  RouteDetail,
  RoutePlan,
  SmartMemberRoute,
  SmartRouteAnalysis,
  SmartRouteCandidate
} from "./types";

type SmartPlanInput = {
  people: PersonInput[];
  destination: DestinationInput;
  city: string;
};

type RoutePlanWithDetail = RoutePlan & { routeDetail?: RouteDetail };

const MAX_CANDIDATES_TO_SCORE = 5;

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function minutes(seconds: number) {
  return Math.round(seconds / 60);
}

function centroid(points: Point[]): Point {
  return {
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length
  };
}

function dedupeCandidates(points: LocationPoint[]) {
  const seen = new Set<string>();
  const result: LocationPoint[] = [];
  for (const point of points) {
    const key = `${point.name}:${point.lng.toFixed(4)},${point.lat.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }
  return result;
}

function candidateLooksUsable(point: LocationPoint) {
  if (!point.name.trim()) return false;
  if (/出入口|入口|出口|[A-Z]\d?口$/.test(point.name)) return false;
  return true;
}

function buildBaseline(people: PersonInput[], destination: DestinationInput, matrix: MatrixResult) {
  const baseline = planPickupRoutes(people, destination, matrix);
  return baseline.best;
}

async function getCandidateMeetings(amap: AmapClient, input: SmartPlanInput) {
  const drivers = input.people.filter((person) => person.hasCar);
  const passengers = input.people.filter((person) => !person.hasCar);
  const center = centroid(passengers.map((person) => person.location));
  const driverStarts: LocationPoint[] = drivers.map((driver) => ({
    id: `driver-start-${driver.id}`,
    name: `${driver.name}出发点`,
    address: driver.address,
    lng: driver.location.lng,
    lat: driver.location.lat
  }));

  const metro = await amap
    .around(center, { city: input.city, types: "150500", radius: 16000, offset: 12 })
    .catch(() => [] as LocationPoint[]);
  await pause(450);
  const malls = await amap
    .around(center, { city: input.city, types: "060100", radius: 16000, offset: 8 })
    .catch(() => [] as LocationPoint[]);

  const usableMetro = metro.filter(candidateLooksUsable).slice(0, 4);
  const usableMalls = malls.filter(candidateLooksUsable).slice(0, 2);
  return dedupeCandidates([...driverStarts, ...usableMetro, ...usableMalls]).slice(0, MAX_CANDIDATES_TO_SCORE);
}

async function scoreCandidate(amap: AmapClient, input: SmartPlanInput, baseline: RoutePlan, candidate: LocationPoint) {
  const drivers = input.people.filter((person) => person.hasCar);
  const passengers = input.people.filter((person) => !person.hasCar);
  const scoredByDriver: SmartRouteCandidate[] = [];

  for (const driver of drivers) {
    const driverToMeeting = await amap.driveLeg(driver.location, candidate);
    await pause(420);
    const meetingToDestination = await amap.driveLeg(candidate, input.destination.location);
    await pause(420);

    const members: SmartMemberRoute[] = [];
    for (const passenger of passengers) {
      const taxi = await amap.driveLeg(passenger.location, candidate);
      await pause(420);
      const transit = await amap.transitDetail(passenger.location, candidate, input.city).catch(() => null);
      await pause(420);
      const transitLooksUseful = Boolean(transit?.steps.length) && transit!.durationSec <= taxi.durationSec * 1.8 + 900;
      const suggestedMode = transitLooksUseful ? "public_transit" : "taxi";
      const durationSec = suggestedMode === "public_transit" ? transit!.durationSec : taxi.durationSec;
      const distanceM = suggestedMode === "public_transit" ? transit!.walkingDistanceM : taxi.distanceM;
      const suggestion =
        suggestedMode === "public_transit"
          ? `建议公共交通到 ${candidate.name}，约 ${minutes(transit!.durationSec)} 分钟：${transit!.steps.join("；") || "按高德公交推荐换乘"}。`
          : `建议打车或接送到 ${candidate.name}，约 ${minutes(taxi.durationSec)} 分钟、${(taxi.distanceM / 1000).toFixed(1)} 公里。`;

      members.push({
        personId: passenger.id,
        personName: passenger.name,
        durationSec,
        distanceM,
        suggestedMode,
        suggestion,
        transit: transit || undefined
      });
    }

    const gatherReadySec = Math.max(driverToMeeting.durationSec, ...members.map((member) => member.durationSec));
    const totalDurationSec = gatherReadySec + meetingToDestination.durationSec;
    const totalDistanceM = driverToMeeting.distanceM + meetingToDestination.distanceM;
    const savedVsBaselineSec = baseline.totalDurationSec - totalDurationSec;
    const reason =
      savedVsBaselineSec > 0
        ? `比司机逐个接人约快 ${minutes(savedVsBaselineSec)} 分钟，主要减少跨城绕行。`
        : `未比司机逐个接人更快，但可作为少停车的集合备选。`;

    scoredByDriver.push({
      meetingPointId: candidate.id,
      meetingPointName: candidate.name,
      address: candidate.address || candidate.name,
      location: { lng: candidate.lng, lat: candidate.lat },
      driverId: driver.id,
      driverName: driver.name,
      driverToMeetingSec: driverToMeeting.durationSec,
      driverToMeetingDistanceM: driverToMeeting.distanceM,
      meetingToDestinationSec: meetingToDestination.durationSec,
      meetingToDestinationDistanceM: meetingToDestination.distanceM,
      gatherReadySec,
      totalDurationSec,
      totalDistanceM,
      savedVsBaselineSec,
      members,
      reason
    });
  }

  return scoredByDriver.sort((a, b) => a.totalDurationSec - b.totalDurationSec || b.savedVsBaselineSec - a.savedVsBaselineSec)[0];
}

function buildMeetingPlan(selected: SmartRouteCandidate, input: SmartPlanInput, directToDestination: { durationSec: number; distanceM: number }): RoutePlan {
  const driver = input.people.find((person) => person.id === selected.driverId);
  if (!driver) throw new Error("智能方案无法识别推荐司机");
  const waitAtMeetingSec = Math.max(0, selected.gatherReadySec - selected.driverToMeetingSec);
  const segments = [
    {
      fromId: driver.id,
      toId: selected.meetingPointId,
      fromName: driver.name,
      toName: selected.meetingPointName,
      durationSec: selected.driverToMeetingSec,
      distanceM: selected.driverToMeetingDistanceM,
      arrivalOffsetSec: selected.driverToMeetingSec
    },
    {
      fromId: selected.meetingPointId,
      toId: "dest",
      fromName: selected.meetingPointName,
      toName: input.destination.name,
      durationSec: selected.meetingToDestinationSec + waitAtMeetingSec,
      distanceM: selected.meetingToDestinationDistanceM,
      arrivalOffsetSec: selected.totalDurationSec
    }
  ];

  return {
    id: `smart-${selected.driverId}-${selected.meetingPointId}`,
    driverId: selected.driverId,
    driverName: selected.driverName,
    orderedPassengerIds: [selected.meetingPointId],
    orderedPassengerNames: [selected.meetingPointName],
    segments,
    totalDurationSec: selected.totalDurationSec,
    totalDistanceM: selected.totalDistanceM,
    directDurationSec: directToDestination.durationSec,
    directDistanceM: directToDestination.distanceM,
    detourDurationSec: Math.max(0, selected.totalDurationSec - directToDestination.durationSec),
    maxPassengerWaitSec: Math.max(...selected.members.map((member) => member.durationSec)),
    score: selected.totalDurationSec
  };
}

export async function planSmartRoute(amap: AmapClient, input: SmartPlanInput) {
  const drivers = input.people.filter((person) => person.hasCar);
  const passengers = input.people.filter((person) => !person.hasCar);
  if (!drivers.length) throw new Error("请至少勾选 1 位开车人员");
  if (!passengers.length) throw new Error("智能集合点需要至少 1 位乘客");

  const matrixPoints = [
    ...input.people.map((person) => ({ id: person.id, name: person.name, lng: person.location.lng, lat: person.location.lat })),
    { id: "dest", name: input.destination.name, lng: input.destination.location.lng, lat: input.destination.location.lat }
  ];
  const matrix = await amap.matrix(matrixPoints);
  const baseline = buildBaseline(input.people, input.destination, matrix);
  const candidates = await getCandidateMeetings(amap, input);
  const scored: SmartRouteCandidate[] = [];

  for (const candidate of candidates) {
    const result = await scoreCandidate(amap, input, baseline, candidate).catch(() => null);
    if (result) scored.push(result);
  }

  const ranked = scored.sort((a, b) => a.totalDurationSec - b.totalDurationSec || b.savedVsBaselineSec - a.savedVsBaselineSec);
  const selected = ranked[0];
  if (!selected) throw new Error("高德没有返回可用的智能集合点候选");

  const selectedDriver = input.people.find((person) => person.id === selected.driverId)!;
  const directToDestination = await amap.driveLeg(selectedDriver.location, input.destination.location);
  const best = buildMeetingPlan(selected, input, directToDestination) as RoutePlanWithDetail;
  best.routeDetail = await amap.routeDetail(
    selectedDriver.location,
    [selected.location],
    input.destination.location
  );

  const meetingRoutes: MeetingRouteSummary[] = [
    {
      meetingPointId: selected.meetingPointId,
      meetingPointName: selected.meetingPointName,
      members: selected.members
    }
  ];

  const analysis: SmartRouteAnalysis = {
    baselineTotalDurationSec: baseline.totalDurationSec,
    baselineDriverName: baseline.driverName,
    baselineOrderNames: baseline.orderedPassengerNames,
    selectedMeeting: selected,
    candidates: ranked.slice(0, 5),
    summary:
      selected.savedVsBaselineSec > 0
        ? `建议让乘客先到 ${selected.meetingPointName} 集合，再由 ${selected.driverName} 接集合点去终点，预计比逐个接人快 ${minutes(selected.savedVsBaselineSec)} 分钟。`
        : `候选集合点没有明显快过逐个接人，当前最稳方案仍是 ${baseline.driverName} 按顺序接人。`,
    caveats: [
      "集合点候选来自高德 POI 周边搜索，优先地铁站和商场，未判断停车位实际空闲。",
      "公交时间来自高德当前估算，未包含个人提前出门意愿和等待成本。",
      "为避免高德 QPS 限流，当前只评分少量候选点。"
    ]
  };

  return {
    generatedAt: new Date().toISOString(),
    mode: "single-driver" as const,
    source: "smart" as const,
    best,
    alternatives: [],
    driverCandidates: [best],
    driverRoutes: [best],
    meetingRoutes,
    smartAnalysis: analysis
  };
}
