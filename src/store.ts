import type { AppState, MeetingPointState, PersonState, Suggestion } from "./types";

const STORAGE_KEY = "routeos-state-v1";

function id() {
  return Math.random().toString(36).slice(2, 9);
}

export function createPerson(overrides: Partial<PersonState> = {}): PersonState {
  return {
    id: overrides.id || id(),
    name: overrides.name || "",
    addressInput: overrides.addressInput || "",
    selectedAddress: overrides.selectedAddress || null,
    hasCar: overrides.hasCar || false,
    note: overrides.note || "",
    assignedDriverId: overrides.assignedDriverId || ""
  };
}

export function createMeetingPoint(overrides: Partial<MeetingPointState> = {}): MeetingPointState {
  return {
    id: overrides.id || id(),
    name: overrides.name || "集合点",
    addressInput: overrides.addressInput || "",
    selectedAddress: overrides.selectedAddress || null,
    memberIds: overrides.memberIds || [],
    assignedDriverId: overrides.assignedDriverId || ""
  };
}

export function createSuggestion(name: string, address: string, lng: number, lat: number): Suggestion {
  return {
    id: `${name}-${lng}-${lat}`,
    name,
    address,
    lng,
    lat
  };
}

export function defaultState(): AppState {
  return {
    city: "深圳",
    destinationInput: "",
    destination: null,
    timeConstraint: null,
    people: [createPerson(), createPerson()],
    meetingPoints: [],
    routeResult: null,
    loading: false,
    error: null,
    hasGeneratedRoute: false
  };
}

function looksLikeSeedData(state: AppState) {
  const names = state.people.map((person) => person.name).filter(Boolean);
  if (!names.length) return false;
  const seedNames = new Set(["张三", "李四", "王五", "赵六", "钱七"]);
  return names.every((name) => seedNames.has(name)) && names.some((name) => name === "张三");
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as AppState;
    const loaded = {
      ...defaultState(),
      ...parsed,
      routeResult: null,
      loading: false,
      error: null,
      people: Array.isArray(parsed.people) && parsed.people.length ? parsed.people.map((person) => createPerson(person)) : defaultState().people,
      meetingPoints: Array.isArray(parsed.meetingPoints) ? parsed.meetingPoints.map((meeting) => createMeetingPoint(meeting)) : []
    };
    return looksLikeSeedData(loaded) ? defaultState() : loaded;
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState) {
  const { routeResult: _routeResult, loading: _loading, error: _error, ...persisted } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}
