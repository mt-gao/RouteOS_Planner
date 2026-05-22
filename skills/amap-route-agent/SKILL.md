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
   - Candidate search should prioritize subway stations, then malls or clear pickup landmarks.
   - Score candidates with driver-to-meeting drive time, each passenger-to-meeting transit/taxi time, and meeting-to-destination drive time.
4. If the user asks about a specific address or place, call `amap_suggest_address`.
5. Explain from tool results only.

## Available Tool Semantics

### `amap_suggest_address`

Finds AMap POI candidates for a keyword in a city. Use before editing a manifest with a new unconfirmed address.

### `update_manifest`

Returns a manifest patch to the UI. Use it to update city, destination, people, meeting points, car ownership, notes, or assignments.

### `amap_generate_smart_plan`

Runs the app's AMap-backed smart planner:

- searches around passenger centroid for candidate subway stations and malls;
- scores a small candidate set under QPS limits;
- compares against the baseline of driver picking everyone one by one;
- returns a selected meeting point, route details, member transit/taxi advice, and caveats.

## Deadline Explanations

When the user asks a deadline question such as "if everyone must gather before 09:00, when should a specific member depart?":

1. Identify the relevant meeting point and member route from the latest route result.
2. Use the member's route duration.
3. Pick a buffer based on mode.
4. Calculate latest departure.
5. Tell the user the transport mode, route summary, latest departure, and confidence caveat.

Never answer deadline questions from intuition alone. If there is no latest route result, ask the user to generate a smart route first or call `amap_generate_smart_plan`.
