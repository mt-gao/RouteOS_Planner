import type { LocationPoint, MatrixResult, Point, RouteDetail, TransitRouteDetail } from "./types";

type AmapPoi = {
  id?: string;
  name?: string;
  address?: string | unknown[];
  location?: string;
};

type AmapDistanceResult = {
  origin_id?: string;
  dest_id?: string;
  distance?: string;
  duration?: string;
};

type AroundSearchOptions = {
  keywords?: string;
  types?: string;
  radius?: number;
  offset?: number;
  city?: string;
};

type AmapTransitSegment = {
  walking?: {
    distance?: string;
    duration?: string;
  };
  bus?: {
    buslines?: Array<{
      name?: string;
      duration?: string;
      departure_stop?: { name?: string };
      arrival_stop?: { name?: string };
    }>;
  };
};

const AMAP_REST_BASE = "https://restapi.amap.com";
const AMAP_JS_BASE = "https://webapi.amap.com/maps";
const QPS_LIMIT_ERROR = "CUQPS_HAS_EXCEEDED_THE_LIMIT";
const AMAP_REST_MIN_INTERVAL_MS = 360;
let lastRestRequestAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRestBudget() {
  const now = Date.now();
  const waitMs = Math.max(0, lastRestRequestAt + AMAP_REST_MIN_INTERVAL_MS - now);
  if (waitMs > 0) await sleep(waitMs);
  lastRestRequestAt = Date.now();
}

function toLocation(location?: string): Point | null {
  if (!location || !location.includes(",")) return null;
  const [lng, lat] = location.split(",").map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

function stringifyAddress(address: AmapPoi["address"]) {
  if (Array.isArray(address)) return address.join("");
  return typeof address === "string" ? address : "";
}

async function fetchJson<T>(url: URL, retries = 2): Promise<T> {
  await waitForRestBudget();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`高德请求失败：HTTP ${response.status}`);
  }
  const data = (await response.json()) as T & { status?: string; info?: string; infocode?: string };
  if (data.status && data.status !== "1") {
    const message = `${data.info || ""}${data.infocode || ""}`;
    if (retries > 0 && message.includes(QPS_LIMIT_ERROR)) {
      await sleep((3 - retries) * 700);
      return fetchJson<T>(url, retries - 1);
    }
    throw new Error(`高德返回错误：${data.info || data.infocode || "unknown"}`);
  }
  return data;
}

export class AmapClient {
  constructor(
    private readonly key: string,
    private readonly jsKey = key,
    private readonly securityJsCode?: string
  ) {}

  async loadJsApi(callback: string) {
    const url = new URL(AMAP_JS_BASE);
    url.searchParams.set("v", "2.0");
    url.searchParams.set("key", this.jsKey);
    url.searchParams.set("plugin", "AMap.Scale,AMap.ToolBar");
    url.searchParams.set("callback", callback);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`高德地图脚本加载失败：HTTP ${response.status}`);
    }
    const script = await response.text();
    const securityConfig = this.securityJsCode
      ? `window._AMapSecurityConfig=${JSON.stringify({ securityJsCode: this.securityJsCode })};\n`
      : "";
    return `${securityConfig}${script}`;
  }

  async suggest(keyword: string, city = "深圳"): Promise<LocationPoint[]> {
    const url = new URL("/v3/place/text", AMAP_REST_BASE);
    url.searchParams.set("key", this.key);
    url.searchParams.set("keywords", keyword);
    url.searchParams.set("city", city);
    url.searchParams.set("offset", "8");
    url.searchParams.set("page", "1");
    url.searchParams.set("extensions", "base");
    const data = await fetchJson<{ pois?: AmapPoi[] }>(url);
    return (data.pois || [])
      .map((poi, index) => {
        const location = toLocation(poi.location);
        if (!location) return null;
        return {
          id: poi.id || `${keyword}-${index}`,
          name: poi.name || keyword,
          address: stringifyAddress(poi.address),
          ...location
        };
      })
      .filter(Boolean) as LocationPoint[];
  }

  async around(point: Point, options: AroundSearchOptions = {}): Promise<LocationPoint[]> {
    const url = new URL("/v3/place/around", AMAP_REST_BASE);
    url.searchParams.set("key", this.key);
    url.searchParams.set("location", `${point.lng},${point.lat}`);
    url.searchParams.set("city", options.city || "深圳");
    url.searchParams.set("radius", String(options.radius || 12000));
    url.searchParams.set("offset", String(options.offset || 8));
    url.searchParams.set("extensions", "base");
    if (options.keywords) url.searchParams.set("keywords", options.keywords);
    if (options.types) url.searchParams.set("types", options.types);
    const data = await fetchJson<{ pois?: AmapPoi[] }>(url);
    return (data.pois || [])
      .map((poi, index) => {
        const location = toLocation(poi.location);
        if (!location) return null;
        return {
          id: poi.id || `${options.types || options.keywords || "poi"}-${index}`,
          name: poi.name || "候选集合点",
          address: stringifyAddress(poi.address),
          ...location
        };
      })
      .filter(Boolean) as LocationPoint[];
  }

  async geocode(address: string, city = "深圳"): Promise<LocationPoint[]> {
    const url = new URL("/v3/geocode/geo", AMAP_REST_BASE);
    url.searchParams.set("key", this.key);
    url.searchParams.set("address", address);
    url.searchParams.set("city", city);
    const data = await fetchJson<{ geocodes?: Array<{ formatted_address?: string; location?: string }> }>(url);
    return (data.geocodes || [])
      .map((geo, index) => {
        const location = toLocation(geo.location);
        if (!location) return null;
        return {
          id: `${address}-${index}`,
          name: address,
          address: geo.formatted_address || address,
          ...location
        };
      })
      .filter(Boolean) as LocationPoint[];
  }

  async matrix(points: Array<LocationPoint>): Promise<MatrixResult> {
    const normalized = points.map((point) => ({
      id: point.id,
      name: point.name,
      lng: point.lng,
      lat: point.lat
    }));
    const durations: Record<string, number> = {};
    const distances: Record<string, number> = {};

    for (const destination of normalized) {
      const origins = normalized.filter((point) => point.id !== destination.id);
      if (!origins.length) continue;

      const url = new URL("/v3/distance", AMAP_REST_BASE);
      url.searchParams.set("key", this.key);
      url.searchParams.set("type", "1");
      url.searchParams.set("destination", `${destination.lng},${destination.lat}`);
      url.searchParams.set("origins", origins.map((point) => `${point.lng},${point.lat}`).join("|"));
      const data = await fetchJson<{ results?: AmapDistanceResult[] }>(url);

      for (const item of data.results || []) {
        const originIndex = Math.max(0, Number(item.origin_id || 1) - 1);
        const origin = origins[originIndex];
        if (!origin) continue;
        const pairKey = `${origin.id}:${destination.id}`;
        durations[pairKey] = Number(item.duration || 0);
        distances[pairKey] = Number(item.distance || 0);
      }

      await sleep(380);
    }

    return { durations, distances };
  }

  async driveLeg(origin: Point, destination: Point): Promise<{ durationSec: number; distanceM: number }> {
    if (Math.abs(origin.lng - destination.lng) < 0.000001 && Math.abs(origin.lat - destination.lat) < 0.000001) {
      return { durationSec: 0, distanceM: 0 };
    }
    const url = new URL("/v3/distance", AMAP_REST_BASE);
    url.searchParams.set("key", this.key);
    url.searchParams.set("type", "1");
    url.searchParams.set("origins", `${origin.lng},${origin.lat}`);
    url.searchParams.set("destination", `${destination.lng},${destination.lat}`);
    const data = await fetchJson<{ results?: AmapDistanceResult[] }>(url);
    const item = data.results?.[0];
    if (!item) throw new Error("高德没有返回可用驾车距离");
    return {
      durationSec: Number(item.duration || 0),
      distanceM: Number(item.distance || 0)
    };
  }

  async routeDetail(origin: Point, waypoints: Point[], destination: Point, strategy = "0"): Promise<RouteDetail> {
    const url = new URL("/v3/direction/driving", AMAP_REST_BASE);
    url.searchParams.set("key", this.key);
    url.searchParams.set("origin", `${origin.lng},${origin.lat}`);
    url.searchParams.set("destination", `${destination.lng},${destination.lat}`);
    url.searchParams.set("strategy", strategy);
    url.searchParams.set("extensions", "all");
    if (waypoints.length) {
      url.searchParams.set("waypoints", waypoints.map((point) => `${point.lng},${point.lat}`).join(";"));
    }
    const data = await fetchJson<{
      route?: {
        paths?: Array<{
          duration?: string;
          distance?: string;
          tolls?: string;
          steps?: Array<{ instruction?: string; polyline?: string }>;
        }>;
      };
    }>(url);
    const path = data.route?.paths?.[0];
    if (!path) throw new Error("高德没有返回可用驾车路线");

    const polyline = (path.steps || [])
      .flatMap((step) => (step.polyline || "").split(";"))
      .map(toLocation)
      .filter(Boolean) as Point[];

    return {
      durationSec: Number(path.duration || 0),
      distanceM: Number(path.distance || 0),
      tollsYuan: Number(path.tolls || 0),
      polyline,
      steps: (path.steps || []).map((step) => step.instruction || "").filter(Boolean)
    };
  }

  async transitDetail(origin: Point, destination: Point, city = "深圳"): Promise<TransitRouteDetail | null> {
    const url = new URL("/v3/direction/transit/integrated", AMAP_REST_BASE);
    url.searchParams.set("key", this.key);
    url.searchParams.set("origin", `${origin.lng},${origin.lat}`);
    url.searchParams.set("destination", `${destination.lng},${destination.lat}`);
    url.searchParams.set("city", city);
    url.searchParams.set("strategy", "0");
    url.searchParams.set("extensions", "base");

    const data = await fetchJson<{
      route?: {
        transits?: Array<{
          duration?: string;
          walking_distance?: string;
          cost?: string;
          segments?: AmapTransitSegment[];
        }>;
      };
    }>(url, 1);
    const transit = data.route?.transits?.[0];
    if (!transit) return null;

    const steps = (transit.segments || [])
      .flatMap((segment) => {
        const result: string[] = [];
        const walkDistance = Number(segment.walking?.distance || 0);
        if (walkDistance > 80) {
          result.push(`步行约 ${Math.round(walkDistance)} 米`);
        }
        const busline = segment.bus?.buslines?.[0];
        if (busline?.name) {
          const from = busline.departure_stop?.name ? `从 ${busline.departure_stop.name}` : "";
          const to = busline.arrival_stop?.name ? `到 ${busline.arrival_stop.name}` : "";
          result.push(`${from} 乘 ${busline.name} ${to}`.trim());
        }
        return result;
      })
      .filter(Boolean)
      .slice(0, 6);

    return {
      durationSec: Number(transit.duration || 0),
      walkingDistanceM: Number(transit.walking_distance || 0),
      costYuan: transit.cost ? Number(transit.cost) : undefined,
      steps
    };
  }
}
