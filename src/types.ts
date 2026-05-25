export type Point = {
  lng: number;
  lat: number;
};

export type Suggestion = Point & {
  id: string;
  name: string;
  address?: string;
};

export type PersonState = {
  id: string;
  name: string;
  addressInput: string;
  selectedAddress: Suggestion | null;
  hasCar: boolean;
  note: string;
  assignedDriverId: string;
};

export type MeetingPointState = {
  id: string;
  name: string;
  addressInput: string;
  selectedAddress: Suggestion | null;
  memberIds: string[];
  assignedDriverId: string;
};

export type AppState = {
  city: string;
  destinationInput: string;
  destination: Suggestion | null;
  timeConstraint: TimeConstraint | null;
  people: PersonState[];
  meetingPoints: MeetingPointState[];
  routeResult: RoutePlanResponse | null;
  loading: boolean;
  error: string | null;
  hasGeneratedRoute?: boolean;
};

export type TimeConstraint = {
  kind: "departure" | "arrival";
  time: string;
  source?: "manual" | "chat";
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
  routeDetail?: RouteDetail;
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

export type RoutePlanResponse = {
  generatedAt: string;
  mode: "single-driver" | "multi-driver";
  source?: "manual" | "smart";
  planKind?: PlanKind;
  timeConstraint?: TimeConstraint;
  shareText?: string;
  timePlan?: RouteTimePlan;
  best: RoutePlan;
  alternatives: RoutePlan[];
  driverCandidates: RoutePlan[];
  driverRoutes: RoutePlan[];
  meetingRoutes: MeetingRouteSummary[];
  executionTimeline?: ExecutionTimelineItem[];
  memberPlans?: MemberPlan[];
  planWarnings?: PlanWarning[];
  generatedMeetingPoints?: Array<{
    id: string;
    name: string;
    address: string;
    location: Point;
    memberIds: string[];
    assignedDriverId?: string;
  }>;
  smartAnalysis?: SmartRouteAnalysis;
};

export type RouteTimeMember = {
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

export type RouteTimeDriver = {
  driverId: string;
  driverName: string;
  departureLabel: string;
  destinationArrivalLabel: string;
  routeLabel: string;
  absolute: boolean;
};

export type RouteTimePlan = {
  basisLabel: string;
  driverStartLabel: string;
  destinationArrivalLabel: string;
  members: RouteTimeMember[];
  drivers: RouteTimeDriver[];
};
