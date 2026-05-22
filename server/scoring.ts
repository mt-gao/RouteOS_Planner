import type { RoutePlan } from "./types";

export function scoreRoute(plan: Pick<RoutePlan, "totalDurationSec" | "detourDurationSec" | "maxPassengerWaitSec">): number {
  return Math.round(plan.totalDurationSec + plan.detourDurationSec * 0.35 + plan.maxPassengerWaitSec * 0.15);
}

