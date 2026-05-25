export type Point = {
  lng: number;
  lat: number;
};

export type LocationPoint = Point & {
  id: string;
  name: string;
  address?: string;
};

export type PersonInput = {
  id: string;
  name: string;
  address: string;
  location: Point;
  hasCar: boolean;
  note?: string;
  assignedDriverId?: string;
};

export type DestinationInput = {
  name: string;
  address: string;
  location: Point;
};

export type TimeConstraint = {
  kind: "departure" | "arrival";
  time: string;
  source?: "manual" | "chat";
};

export type MeetingPointInput = {
  id: string;
  name: string;
  address: string;
  location: Point;
  memberIds: string[];
  assignedDriverId?: string;
};

export type PickupStopInput = {
  id: string;
  name: string;
  address: string;
  location: Point;
  kind: "person" | "meeting";
  memberIds?: string[];
  memberNames?: string[];
  assignedDriverId?: string;
};

export type MatrixResult = {
  durations: Record<string, number>;
  distances: Record<string, number>;
};

export type RouteSegment = {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  durationSec: number;
  distanceM: number;
  arrivalOffsetSec: number;
};

export type RoutePlan = {
  id: string;
  driverId: string;
  driverName: string;
  orderedPassengerIds: string[];
  orderedPassengerNames: string[];
  segments: RouteSegment[];
  totalDurationSec: number;
  totalDistanceM: number;
  directDurationSec: number;
  directDistanceM: number;
  detourDurationSec: number;
  maxPassengerWaitSec: number;
  score: number;
};

export type PlanKind = "direct_pickup" | "single_meeting" | "multi_meeting" | "hybrid_pickup" | "multi_driver";

export type ExecutionTimelineItem = {
  type: "start" | "pickup" | "meeting" | "destination";
  driverId: string;
  driverName: string;
  stopId: string;
  stopName: string;
  arrivalOffsetSec: number;
  departOffsetSec: number;
  driveDurationSec: number;
  waitDurationSec: number;
  distanceM: number;
  boardingNames: string[];
};

export type MemberPlan = {
  personId: string;
  personName: string;
  pickupPointId: string;
  pickupPointName: string;
  pickupPointKind: "origin" | "meeting";
  assignedDriverId: string;
  assignedDriverName: string;
  suggestedMode: "taxi" | "public_transit" | "wait_at_origin";
  travelDurationSec: number;
  distanceM: number;
  latestDepartureOffsetSec: number;
  arrivalOffsetSec: number;
  boardOffsetSec: number;
  waitDurationSec: number;
  suggestion: string;
  transit?: TransitRouteDetail;
};

export type PlanWarning = {
  level: "info" | "warning";
  message: string;
  personId?: string;
  stopId?: string;
};

export type SmartMemberRoute = {
  personId: string;
  personName: string;
  durationSec: number;
  distanceM: number;
  suggestedMode: "taxi" | "public_transit";
  suggestion: string;
  transit?: TransitRouteDetail;
};

export type SmartRouteCandidate = {
  meetingPointId: string;
  meetingPointName: string;
  address: string;
  location: Point;
  driverId: string;
  driverName: string;
  driverToMeetingSec: number;
  driverToMeetingDistanceM: number;
  meetingToDestinationSec: number;
  meetingToDestinationDistanceM: number;
  gatherReadySec: number;
  totalDurationSec: number;
  totalDistanceM: number;
  savedVsBaselineSec: number;
  members: SmartMemberRoute[];
  reason: string;
};

export type SmartRouteAnalysis = {
  baselineTotalDurationSec: number;
  baselineDriverName: string;
  baselineOrderNames: string[];
  selectedMeeting?: SmartRouteCandidate;
  selectedMeetings?: SmartRouteCandidate[];
  candidates: SmartRouteCandidate[];
  summary: string;
  caveats: string[];
};

export type MeetingRouteSummary = {
  meetingPointId: string;
  meetingPointName: string;
  members: Array<{
    personId: string;
    personName: string;
    durationSec: number;
    distanceM: number;
    suggestedMode: "taxi" | "public_transit";
    suggestion: string;
    transit?: TransitRouteDetail;
  }>;
};

export type RouteDetail = {
  durationSec: number;
  distanceM: number;
  tollsYuan: number;
  polyline: Point[];
  steps: string[];
};

export type TransitRouteDetail = {
  durationSec: number;
  walkingDistanceM: number;
  costYuan?: number;
  steps: string[];
};
