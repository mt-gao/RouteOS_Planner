import type { DestinationInput, MeetingPointInput, MemberPlan, PersonInput, RoutePlan, TimeConstraint } from "./types";

type RouteWithDetail = RoutePlan & { routeDetail?: unknown };

type RouteResultLike = {
  mode: "single-driver" | "multi-driver";
  source?: "manual" | "smart";
  planKind?: string;
  best: RouteWithDetail;
  driverRoutes?: RouteWithDetail[];
  memberPlans?: MemberPlan[];
  meetingRoutes?: Array<{
    meetingPointId: string;
    meetingPointName: string;
    members: Array<{
      personId: string;
      personName: string;
      durationSec: number;
      distanceM: number;
      suggestedMode: "taxi" | "public_transit";
      suggestion: string;
    }>;
  }>;
  generatedMeetingPoints?: Array<{
    id: string;
    name: string;
    address: string;
    location: { lng: number; lat: number };
    memberIds: string[];
    assignedDriverId?: string;
  }>;
};

type RouteShareContext = {
  people: PersonInput[];
  destination: DestinationInput;
  meetingPoints?: MeetingPointInput[];
  timeConstraint?: TimeConstraint | null;
};

type RouteTimeMember = {
  personId: string;
  personName: string;
  pickupPointName: string;
  pickupPointKind: "origin" | "meeting";
  assignedDriverName: string;
  departureLabel: string;
  pickupLabel: string;
  destinationArrivalLabel: string;
  actionLabel: string;
  absolute: boolean;
};

type RouteTimeDriver = {
  driverId: string;
  driverName: string;
  departureLabel: string;
  destinationArrivalLabel: string;
  routeLabel: string;
  absolute: boolean;
};

type RouteTimePlan = {
  basisLabel: string;
  driverStartLabel: string;
  destinationArrivalLabel: string;
  members: RouteTimeMember[];
  drivers: RouteTimeDriver[];
};

function minutes(seconds = 0) {
  return Math.round(seconds / 60);
}

function formatOffset(seconds = 0) {
  const min = minutes(seconds);
  if (min < 0) return `T-${Math.abs(min)}分钟`;
  return `T+${min}分钟`;
}

function parseClock(value?: string) {
  const match = value?.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatClock(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function routeForDriver(result: RouteResultLike) {
  return result.driverRoutes?.length ? result.driverRoutes : [result.best];
}

function routeByStop(routes: RouteWithDetail[], stopId: string) {
  return routes.find((route) => route.orderedPassengerIds.includes(stopId));
}

function arrivalOffset(route: RoutePlan, stopId: string) {
  return route.segments.find((segment) => segment.toId === stopId)?.arrivalOffsetSec;
}

function cleanTimeConstraint(timeConstraint?: TimeConstraint | null) {
  if (!timeConstraint || !parseClock(timeConstraint.time)) return null;
  return timeConstraint;
}

function buildTimeFormatter(result: RouteResultLike, timeConstraint?: TimeConstraint | null) {
  const constraint = cleanTimeConstraint(timeConstraint);
  const clock = parseClock(constraint?.time);
  const absolute = clock !== null;
  const driverStartMinutes =
    clock === null || !constraint ? null : constraint.kind === "arrival" ? clock - minutes(result.best.totalDurationSec) : clock;
  const label = (offsetSec = 0) => (driverStartMinutes === null ? formatOffset(offsetSec) : formatClock(driverStartMinutes + minutes(offsetSec)));
  let basisLabel = "未指定具体时间，以下按司机出发时间 T 计算";
  if (constraint && driverStartMinutes !== null) {
    basisLabel = constraint.kind === "arrival" ? `按 ${constraint.time} 到达目的地倒推` : `按 ${constraint.time} 司机出发计算`;
  }
  return { absolute, label, basisLabel, driverStartLabel: label(0), constraint };
}

function routeDestinationOffset(result: RouteResultLike, route?: RoutePlan) {
  return route?.totalDurationSec ?? result.best.totalDurationSec;
}

function routeOrderLabel(route: RoutePlan, destination: DestinationInput) {
  return [route.driverName, ...route.orderedPassengerNames, destination.name || destination.address || "目的地"].join(" -> ");
}

function generatedMeetingInputs(result: RouteResultLike): MeetingPointInput[] {
  return (result.generatedMeetingPoints || []).map((point) => ({
    id: point.id,
    name: point.name,
    address: point.address,
    location: point.location,
    memberIds: point.memberIds,
    assignedDriverId: point.assignedDriverId
  }));
}

function uniqueMembers(items: RouteTimeMember[]) {
  const seen = new Set<string>();
  const result: RouteTimeMember[] = [];
  for (const item of items) {
    if (seen.has(item.personId)) continue;
    seen.add(item.personId);
    result.push(item);
  }
  return result;
}

function buildMembersFromMemberPlans(result: RouteResultLike, formatter: ReturnType<typeof buildTimeFormatter>) {
  const routes = routeForDriver(result);
  return (result.memberPlans || []).map((plan) => {
    const route = routes.find((item) => item.driverId === plan.assignedDriverId) || routeByStop(routes, plan.pickupPointId) || result.best;
    const departureLabel =
      plan.suggestedMode === "wait_at_origin" ? formatter.label(plan.boardOffsetSec) : formatter.label(plan.latestDepartureOffsetSec);
    const actionLabel =
      plan.suggestedMode === "wait_at_origin"
        ? `${departureLabel} 在出发点等 ${plan.assignedDriverName} 接`
        : `${departureLabel} 出发，去 ${plan.pickupPointName} 集合`;
    return {
      personId: plan.personId,
      personName: plan.personName,
      pickupPointName: plan.pickupPointName,
      pickupPointKind: plan.pickupPointKind,
      assignedDriverName: plan.assignedDriverName,
      departureLabel,
      pickupLabel: formatter.label(plan.boardOffsetSec),
      destinationArrivalLabel: formatter.label(routeDestinationOffset(result, route)),
      actionLabel: `${actionLabel}，${formatter.label(plan.boardOffsetSec)} 上车`,
      absolute: formatter.absolute
    };
  });
}

function buildMembersFromManualResult(
  result: RouteResultLike,
  context: RouteShareContext,
  formatter: ReturnType<typeof buildTimeFormatter>
) {
  const members: RouteTimeMember[] = [];
  const routes = routeForDriver(result);
  const peopleById = new Map(context.people.map((person) => [person.id, person]));
  const meetingPoints = [...(context.meetingPoints || []), ...generatedMeetingInputs(result)];
  const meetingsById = new Map(meetingPoints.map((meeting) => [meeting.id, meeting]));
  const meetingRouteById = new Map((result.meetingRoutes || []).map((meeting) => [meeting.meetingPointId, meeting]));

  for (const route of routes) {
    for (const stopId of route.orderedPassengerIds) {
      const stopOffset = arrivalOffset(route, stopId);
      if (!Number.isFinite(stopOffset)) continue;

      const meeting = meetingsById.get(stopId);
      if (meeting) {
        const meetingRoute = meetingRouteById.get(stopId);
        for (const memberId of meeting.memberIds) {
          const person = peopleById.get(memberId);
          if (!person) continue;
          const memberRoute = meetingRoute?.members.find((member) => member.personId === memberId);
          const latestDeparture = (stopOffset || 0) - (memberRoute?.durationSec || 0);
          const departureLabel = formatter.label(latestDeparture);
          const pickupLabel = formatter.label(stopOffset || 0);
          members.push({
            personId: person.id,
            personName: person.name,
            pickupPointName: meeting.name,
            pickupPointKind: "meeting",
            assignedDriverName: route.driverName,
            departureLabel,
            pickupLabel,
            destinationArrivalLabel: formatter.label(route.totalDurationSec),
            actionLabel: `${departureLabel} 出发，去 ${meeting.name} 集合，${pickupLabel} 上车`,
            absolute: formatter.absolute
          });
        }
        continue;
      }

      const person = peopleById.get(stopId);
      if (!person || person.hasCar) continue;
      const pickupLabel = formatter.label(stopOffset || 0);
      members.push({
        personId: person.id,
        personName: person.name,
        pickupPointName: person.name,
        pickupPointKind: "origin",
        assignedDriverName: route.driverName,
        departureLabel: pickupLabel,
        pickupLabel,
        destinationArrivalLabel: formatter.label(route.totalDurationSec),
        actionLabel: `${pickupLabel} 在出发点等 ${route.driverName} 接`,
        absolute: formatter.absolute
      });
    }
  }

  return uniqueMembers(members);
}

function buildShareText(result: RouteResultLike, context: RouteShareContext, timePlan: RouteTimePlan) {
  const destinationName = context.destination.name || context.destination.address || "目的地";
  const lines = [
    "【接人路线安排】",
    timePlan.basisLabel,
    `目的地：${destinationName}`,
    `预计到达：${timePlan.destinationArrivalLabel}`,
    "",
    "司机路线："
  ];

  for (const driver of timePlan.drivers) {
    lines.push(`- ${driver.driverName}：${driver.departureLabel} 出发，${driver.destinationArrivalLabel} 到达；${driver.routeLabel}`);
  }

  if (timePlan.members.length) {
    lines.push("", "成员安排：");
    for (const member of timePlan.members) {
      const destination = member.destinationArrivalLabel ? `，预计 ${member.destinationArrivalLabel} 到达目的地` : "";
      lines.push(`- ${member.personName}：${member.actionLabel}${destination}`);
    }
  }

  lines.push("", "时间为路线估算，停车、等人和交通波动请预留余量。");
  return lines.join("\n");
}

export function withRouteShare<T extends RouteResultLike>(result: T, context: RouteShareContext) {
  const formatter = buildTimeFormatter(result, context.timeConstraint);
  const routes = routeForDriver(result);
  const drivers: RouteTimeDriver[] = routes.map((route) => ({
    driverId: route.driverId,
    driverName: route.driverName,
    departureLabel: formatter.driverStartLabel,
    destinationArrivalLabel: formatter.label(route.totalDurationSec),
    routeLabel: routeOrderLabel(route, context.destination),
    absolute: formatter.absolute
  }));
  const members = result.memberPlans?.length
    ? buildMembersFromMemberPlans(result, formatter)
    : buildMembersFromManualResult(result, context, formatter);
  const timePlan: RouteTimePlan = {
    basisLabel: formatter.basisLabel,
    driverStartLabel: formatter.driverStartLabel,
    destinationArrivalLabel: formatter.label(result.best.totalDurationSec),
    members,
    drivers
  };

  return {
    ...result,
    timeConstraint: formatter.constraint || undefined,
    timePlan,
    shareText: buildShareText(result, context, timePlan)
  };
}
