# AMap Route Planning Skill

Use this skill when a user asks the route agent to generate, compare, update, or explain pickup routes.

## Inputs

- Current city.
- Destination name, address, and coordinates.
- People list with name, address, coordinates, `hasCar`, notes, and optional driver assignment.
- Optional manual meeting points.
- Latest route result, if any.
- User chat instruction.

## Tool Workflow

1. Validate manifest.
   - Need destination coordinates.
   - Need every person to have name and coordinates.
   - Need at least one driver.
2. If the user asks to change people, destination, city, or meeting points, call `update_manifest`.
3. If the user asks to find fastest route automatically, call `amap_generate_smart_plan`.
   - This intentionally ignores manual meeting points unless the user explicitly asks to preserve them.
   - Compare direct pickup, one meeting point, multiple meeting points, and hybrid pickup.
   - Candidate search should prioritize passenger-home pickup points, subway stations, then malls or clear pickup landmarks.
   - Score plans with driver route time, passenger transit/taxi time, walking distance, early departure burden, and number of stops.
4. If the user asks about a specific address or place, call `amap_suggest_address`.
5. Explain from tool results only.

## Available Tool Semantics

### `amap_suggest_address`

Finds AMap POI candidates for a keyword in a city. Use before editing a manifest with a new unconfirmed address.

### `update_manifest`

Returns a manifest patch to the UI. Use it to update city, destination, people, meeting points, car ownership, notes, or assignments.

### `amap_generate_smart_plan`

Runs the app's AMap-backed smart planner:

- builds candidate passenger clusters;
- searches around cluster centroids for candidate subway stations and malls;
- scores direct pickup, single-meeting, multi-meeting, and hybrid scenarios under QPS limits;
- compares against the baseline of driver picking everyone one by one;
- returns plan type, generated meeting points, route details, execution timeline, member departure advice, warnings, and caveats.

The planner is responsible for time synchronization. If a member route takes longer than the driver needs to reach the pickup point, the member must depart before driver T0, or the plan must explicitly include driver waiting.

## Deadline Explanations

When the user asks a deadline question such as "if everyone must gather before 09:00, when should a specific member depart?":

1. Identify the relevant meeting point and member route from the latest route result.
2. Prefer `memberPlans.latestDepartureOffsetSec` and `memberPlans.boardOffsetSec`.
3. If the user gives an absolute deadline, shift the whole timeline so the relevant all-board or arrival node matches that deadline.
4. Tell the user the transport mode, pickup point, latest departure, and calculation basis.

Never answer deadline questions from intuition alone. If there is no latest route result, ask the user to generate a smart route first or call `amap_generate_smart_plan`.
