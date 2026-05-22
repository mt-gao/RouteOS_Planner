import { scoreRoute } from "./scoring";
import type { DestinationInput, MatrixResult, PersonInput, PickupStopInput, RoutePlan, RouteSegment } from "./types";

type NodeInfo = {
  id: string;
  name: string;
};

function key(fromId: string, toId: string) {
  return `${fromId}:${toId}`;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const result: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) {
      result.push([item, ...tail]);
    }
  });
  return result;
}

function getLeg(matrix: MatrixResult, fromId: string, toId: string) {
  const pairKey = key(fromId, toId);
  const durationSec = matrix.durations[pairKey];
  const distanceM = matrix.distances[pairKey];
  if (!Number.isFinite(durationSec) || !Number.isFinite(distanceM)) {
    throw new Error(`缺少 ${fromId} 到 ${toId} 的路线矩阵数据`);
  }
  return { durationSec, distanceM };
}

function buildSegments(order: NodeInfo[], destination: DestinationInput, matrix: MatrixResult): RouteSegment[] {
  let elapsed = 0;
  const segments: RouteSegment[] = [];
  const nodes = [...order, { id: "dest", name: destination.name || destination.address || "终点" }];

  for (let index = 0; index < nodes.length - 1; index += 1) {
    const from = nodes[index];
    const to = nodes[index + 1];
    const leg = getLeg(matrix, from.id, to.id);
    elapsed += leg.durationSec;
    segments.push({
      fromId: from.id,
      toId: to.id,
      fromName: from.name,
      toName: to.name,
      durationSec: leg.durationSec,
      distanceM: leg.distanceM,
      arrivalOffsetSec: elapsed
    });
  }

  return segments;
}

function evaluateDriverStops(driver: PersonInput, stops: PickupStopInput[], destination: DestinationInput, matrix: MatrixResult): RoutePlan[] {
  const direct = getLeg(matrix, driver.id, "dest");
  return permutations(stops).map((orderedStops) => {
    const order = [
      { id: driver.id, name: driver.name },
      ...orderedStops.map((stop) => ({ id: stop.id, name: stop.name }))
    ];
    const segments = buildSegments(order, destination, matrix);
    const totalDurationSec = segments.reduce((sum, segment) => sum + segment.durationSec, 0);
    const totalDistanceM = segments.reduce((sum, segment) => sum + segment.distanceM, 0);
    const passengerArrivals = segments
      .filter((segment) => orderedStops.some((stop) => stop.id === segment.toId))
      .map((segment) => segment.arrivalOffsetSec);
    const maxPassengerWaitSec = passengerArrivals.length ? Math.max(...passengerArrivals) : 0;
    const detourDurationSec = Math.max(0, totalDurationSec - direct.durationSec);
    const basePlan = {
      id: `${driver.id}-${orderedStops.map((stop) => stop.id).join("-") || "direct"}`,
      driverId: driver.id,
      driverName: driver.name,
      orderedPassengerIds: orderedStops.map((stop) => stop.id),
      orderedPassengerNames: orderedStops.map((stop) => stop.name),
      segments,
      totalDurationSec,
      totalDistanceM,
      directDurationSec: direct.durationSec,
      directDistanceM: direct.distanceM,
      detourDurationSec,
      maxPassengerWaitSec
    };
    return {
      ...basePlan,
      score: scoreRoute(basePlan)
    };
  });
}

function evaluateDriver(driver: PersonInput, passengers: PersonInput[], destination: DestinationInput, matrix: MatrixResult): RoutePlan[] {
  const stops: PickupStopInput[] = passengers.map((person) => ({
    id: person.id,
    name: person.name,
    address: person.address,
    location: person.location,
    kind: "person",
    assignedDriverId: person.assignedDriverId
  }));
  return evaluateDriverStops(driver, stops, destination, matrix);
}

function uniquePlans(plans: RoutePlan[]) {
  const seen = new Set<string>();
  const result: RoutePlan[] = [];
  for (const plan of plans) {
    const signature = `${plan.driverId}:${plan.orderedPassengerIds.join(">")}`;
    if (!seen.has(signature)) {
      seen.add(signature);
      result.push(plan);
    }
  }
  return result;
}

export function planPickupRoutes(people: PersonInput[], destination: DestinationInput, matrix: MatrixResult) {
  const drivers = people.filter((person) => person.hasCar);
  if (!drivers.length) {
    throw new Error("请至少勾选 1 位开车人员作为候选司机");
  }

  const allPlans = drivers.flatMap((driver) => {
    const passengers = people.filter((person) => person.id !== driver.id);
    return evaluateDriver(driver, passengers, destination, matrix);
  });

  const ranked = allPlans.sort((a, b) => a.totalDurationSec - b.totalDurationSec || a.detourDurationSec - b.detourDurationSec);
  const best = ranked[0];
  const fastest = ranked[0];
  const lessDetour = [...ranked].sort((a, b) => a.detourDurationSec - b.detourDurationSec || a.totalDurationSec - b.totalDurationSec)[0];
  const balancedWait = [...ranked].sort((a, b) => a.maxPassengerWaitSec - b.maxPassengerWaitSec || a.totalDurationSec - b.totalDurationSec)[0];
  const driverBest = drivers.map((driver) => ranked.find((plan) => plan.driverId === driver.id)).filter(Boolean) as RoutePlan[];

  return {
    best,
    alternatives: uniquePlans([fastest, lessDetour, balancedWait, ...driverBest]).filter((plan) => plan.id !== best.id).slice(0, 3),
    driverCandidates: driverBest.sort((a, b) => a.totalDurationSec - b.totalDurationSec)
  };
}

function chooseDriverForStop(stop: PickupStopInput, drivers: PersonInput[], matrix: MatrixResult) {
  return [...drivers].sort((a, b) => {
    const aLeg = getLeg(matrix, a.id, stop.id);
    const bLeg = getLeg(matrix, b.id, stop.id);
    return aLeg.durationSec - bLeg.durationSec || aLeg.distanceM - bLeg.distanceM;
  })[0];
}

export function planPickupStops(drivers: PersonInput[], stops: PickupStopInput[], destination: DestinationInput, matrix: MatrixResult) {
  if (!drivers.length) {
    throw new Error("请至少勾选 1 位开车人员作为候选司机");
  }
  if (!stops.length) {
    throw new Error("请至少保留 1 个待接点位或集合点");
  }

  const hasManualAssignments = stops.some((stop) => Boolean(stop.assignedDriverId));
  if (!hasManualAssignments) {
    const allPlans = drivers.flatMap((driver) => evaluateDriverStops(driver, stops, destination, matrix));
    const ranked = allPlans.sort((a, b) => a.totalDurationSec - b.totalDurationSec || a.detourDurationSec - b.detourDurationSec);
    const best = ranked[0];
    const fastest = ranked[0];
    const lessDetour = [...ranked].sort((a, b) => a.detourDurationSec - b.detourDurationSec || a.totalDurationSec - b.totalDurationSec)[0];
    const balancedWait = [...ranked].sort((a, b) => a.maxPassengerWaitSec - b.maxPassengerWaitSec || a.totalDurationSec - b.totalDurationSec)[0];
    const driverBest = drivers.map((driver) => ranked.find((plan) => plan.driverId === driver.id)).filter(Boolean) as RoutePlan[];
    return {
      mode: "single-driver" as const,
      best,
      alternatives: uniquePlans([fastest, lessDetour, balancedWait, ...driverBest]).filter((plan) => plan.id !== best.id).slice(0, 3),
      driverCandidates: driverBest.sort((a, b) => a.totalDurationSec - b.totalDurationSec),
      driverRoutes: [best]
    };
  }

  const assignments = new Map<string, PickupStopInput[]>();
  for (const driver of drivers) assignments.set(driver.id, []);

  for (const stop of stops) {
    const assignedDriver = stop.assignedDriverId ? drivers.find((driver) => driver.id === stop.assignedDriverId) : null;
    const driver = assignedDriver || chooseDriverForStop(stop, drivers, matrix);
    assignments.get(driver.id)?.push(stop);
  }

  const driverRoutes = drivers
    .map((driver) => {
      const assignedStops = assignments.get(driver.id) || [];
      if (!assignedStops.length) return null;
      return evaluateDriverStops(driver, assignedStops, destination, matrix).sort(
        (a, b) => a.totalDurationSec - b.totalDurationSec || a.detourDurationSec - b.detourDurationSec
      )[0];
    })
    .filter(Boolean) as RoutePlan[];

  const totalDurationSec = Math.max(...driverRoutes.map((plan) => plan.totalDurationSec));
  const totalDistanceM = driverRoutes.reduce((sum, plan) => sum + plan.totalDistanceM, 0);
  const directDurationSec = Math.max(...driverRoutes.map((plan) => plan.directDurationSec));
  const best: RoutePlan = {
    id: `multi-${driverRoutes.map((plan) => plan.id).join("_")}`,
    driverId: "multi",
    driverName: "多司机分配",
    orderedPassengerIds: driverRoutes.flatMap((plan) => plan.orderedPassengerIds),
    orderedPassengerNames: driverRoutes.flatMap((plan) => plan.orderedPassengerNames),
    segments: driverRoutes.flatMap((plan) => plan.segments),
    totalDurationSec,
    totalDistanceM,
    directDurationSec,
    directDistanceM: driverRoutes.reduce((sum, plan) => sum + plan.directDistanceM, 0),
    detourDurationSec: Math.max(0, totalDurationSec - directDurationSec),
    maxPassengerWaitSec: Math.max(...driverRoutes.map((plan) => plan.maxPassengerWaitSec)),
    score: driverRoutes.reduce((sum, plan) => sum + plan.score, 0)
  };

  return {
    mode: "multi-driver" as const,
    best,
    alternatives: [],
    driverCandidates: driverRoutes.sort((a, b) => a.totalDurationSec - b.totalDurationSec),
    driverRoutes: driverRoutes.sort((a, b) => a.driverName.localeCompare(b.driverName, "zh-CN"))
  };
}
