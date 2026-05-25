import type { AppState, Point, RoutePlanResponse } from "../types";

declare global {
  interface Window {
    AMap?: any;
    __pickupRouteAmapReady?: () => void;
  }
}

type MarkerPoint = Point & {
  id: string;
  label: string;
  name: string;
  kind: "driver" | "passenger" | "meeting" | "member" | "destination";
};

function loadAmapScript() {
  if (window.AMap) return Promise.resolve(window.AMap);
  return new Promise<any>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("地图加载超时")), 9000);
    window.__pickupRouteAmapReady = () => {
      window.clearTimeout(timeout);
      resolve(window.AMap);
    };
    const script = document.createElement("script");
    script.src = "/api/amap-js?callback=__pickupRouteAmapReady";
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("地图脚本加载失败"));
    };
    document.head.append(script);
  });
}

function markerContent(point: MarkerPoint) {
  return `<div class="map-marker ${point.kind}"><div class="map-pin ${point.kind}"><span>${point.label}</span></div><strong>${point.name}</strong></div>`;
}

function getMarkerPoints(state: AppState): MarkerPoint[] {
  const result = state.routeResult;
  const driverIds = new Set(result?.driverRoutes?.map((plan) => plan.driverId) || []);
  const fallbackDriverId = result?.best.driverId;
  const order = result?.best.orderedPassengerIds || [];
  const groupedPersonIds = new Set([
    ...state.meetingPoints.flatMap((meeting) => meeting.memberIds),
    ...(result?.smartAnalysis?.selectedMeeting?.members.map((member) => member.personId) || [])
  ]);
  const points: MarkerPoint[] = [];

  for (const person of state.people) {
    if (!person.selectedAddress) continue;
    const isDriver = driverIds.has(person.id) || person.id === fallbackDriverId || (!fallbackDriverId && person.hasCar);
    const orderIndex = order.indexOf(person.id);
    points.push({
      id: person.id,
      name: person.name || person.selectedAddress.name,
      lng: person.selectedAddress.lng,
      lat: person.selectedAddress.lat,
      label: isDriver ? "起" : groupedPersonIds.has(person.id) ? "员" : orderIndex >= 0 ? String(orderIndex + 1) : "客",
      kind: isDriver ? "driver" : groupedPersonIds.has(person.id) ? "member" : "passenger"
    });
  }

  for (const [index, meeting] of state.meetingPoints.entries()) {
    if (!meeting.selectedAddress) continue;
    const orderIndex = order.indexOf(meeting.id);
    points.push({
      id: meeting.id,
      name: meeting.name || meeting.selectedAddress.name,
      lng: meeting.selectedAddress.lng,
      lat: meeting.selectedAddress.lat,
      label: orderIndex >= 0 ? String(orderIndex + 1) : `集${index + 1}`,
      kind: "meeting"
    });
  }

  const smartMeeting = result?.smartAnalysis?.selectedMeeting;
  if (smartMeeting) {
    const orderIndex = order.indexOf(smartMeeting.meetingPointId);
    points.push({
      id: smartMeeting.meetingPointId,
      name: smartMeeting.meetingPointName,
      lng: smartMeeting.location.lng,
      lat: smartMeeting.location.lat,
      label: orderIndex >= 0 ? String(orderIndex + 1) : "集",
      kind: "meeting"
    });
  }

  if (state.destination) {
    points.push({
      id: "dest",
      name: state.destination.name,
      lng: state.destination.lng,
      lat: state.destination.lat,
      label: "终",
      kind: "destination"
    });
  }

  return points;
}

function getFallbackPath(state: AppState, points: MarkerPoint[]) {
  const result = state.routeResult;
  if (result?.driverRoutes?.length) {
    return result.driverRoutes.flatMap((plan) => plan.routeDetail?.polyline || []);
  }
  if (result?.best.routeDetail?.polyline?.length) return result.best.routeDetail.polyline;
  if (!result) return points;
  const orderedIds = [result.best.driverId, ...result.best.orderedPassengerIds, "dest"];
  return orderedIds
    .map((id) => points.find((point) => point.id === id))
    .filter(Boolean) as Point[];
}

function bounds(points: Point[]) {
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  return {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats)
  };
}

function getRoutePaths(state: AppState, points: MarkerPoint[]) {
  const result = state.routeResult;
  if (!result) return [];
  if (result.driverRoutes?.length) {
    return result.driverRoutes.map((plan) => {
      if (plan.routeDetail?.polyline?.length) return plan.routeDetail.polyline;
      const orderedIds = [plan.driverId, ...plan.orderedPassengerIds, "dest"];
      return orderedIds.map((id) => points.find((point) => point.id === id)).filter(Boolean) as Point[];
    });
  }
  if (result.best.routeDetail?.polyline?.length) return [result.best.routeDetail.polyline];
  const orderedIds = [result.best.driverId, ...result.best.orderedPassengerIds, "dest"];
  return [orderedIds.map((id) => points.find((point) => point.id === id)).filter(Boolean) as Point[]];
}

function renderLocalRouteLayer(container: HTMLElement, state: AppState, mode: "fallback" | "overlay") {
  const points = getMarkerPoints(state);
  const paths = getRoutePaths(state, points);
  const layerClass = mode === "fallback" ? "fallback-map" : "local-route-layer";
  if (mode === "fallback") {
    container.classList.add("fallback-map");
    container.innerHTML = `<div class="fallback-grid"></div><div class="${layerClass}"></div>`;
  }
  let layer = container.querySelector<HTMLElement>(`.${layerClass}`);
  if (!layer) {
    layer = document.createElement("div");
    layer.className = layerClass;
    container.append(layer);
  }
  layer.innerHTML = `<svg class="fallback-route"></svg><div class="fallback-markers"></div><div class="map-status-pill">本地路线图层</div>`;
  if (!points.length) return;

  const all = [...points, ...paths.flat()];
  const box = bounds(all);
  const pad = 10;
  const width = Math.max(0.001, box.maxLng - box.minLng);
  const height = Math.max(0.001, box.maxLat - box.minLat);
  const project = (point: Point) => ({
    x: pad + ((point.lng - box.minLng) / width) * (100 - pad * 2),
    y: 100 - pad - ((point.lat - box.minLat) / height) * (100 - pad * 2)
  });

  const svg = container.querySelector<SVGSVGElement>(".fallback-route");
  const colors = routeColors;
  paths.forEach((path, index) => {
    if (!svg || path.length <= 1) return;
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", path.map((point) => {
      const projected = project(point);
      return `${projected.x},${projected.y}`;
    }).join(" "));
    polyline.setAttribute("vector-effect", "non-scaling-stroke");
    polyline.setAttribute("stroke", colors[index % colors.length]);
    svg.append(polyline);
  });

  const markerHost = layer.querySelector<HTMLElement>(".fallback-markers");
  for (const point of points) {
    const projected = project(point);
    const marker = document.createElement("div");
    marker.className = `fallback-marker ${point.kind}`;
    marker.style.left = `${projected.x}%`;
    marker.style.top = `${projected.y}%`;
    marker.innerHTML = `<span>${point.label}</span><strong>${point.name}</strong>`;
    markerHost?.append(marker);
  }
}

const routeColors = ["#2563eb", "#ea580c", "#059669", "#9333ea"];

export function createMapView(container: HTMLElement, options?: { onCityDetected?: (city: string) => void }) {
  let amap: any = null;
  let map: any = null;
  let markers: any[] = [];
  let polylines: any[] = [];
  let fallback = false;
  let latestState: AppState | null = null;

  async function init() {
    try {
      amap = await loadAmapScript();
      map = new amap.Map(container, {
        zoom: 10,
        center: [114.0579, 22.5431],
        viewMode: "2D"
      });
      map.addControl(new amap.Scale());
      map.addControl(new amap.ToolBar({ position: { right: "16px", top: "16px" } }));
      // 定位当前城市
      amap.plugin("AMap.Geolocation", () => {
        const geolocation = new amap.Geolocation({
          showMarker: false,
          showButton: false,
          showCircle: false,
          zoomToAccuracy: false
        });
        geolocation.getCityInfo((status: string, result: { city?: string; province?: string }) => {
          if (status === "complete" && result.city) {
            options?.onCityDetected?.(result.city.replace(/市$/, ""));
          }
        });
      });
      if (latestState) update(latestState);
    } catch {
      fallback = true;
      if (latestState) renderLocalRouteLayer(container, latestState, "fallback");
    }
  }

  function clearAmap() {
    if (!map) return;
    if (markers.length) {
      map.remove(markers);
      markers = [];
    }
    if (polylines.length) {
      map.remove(polylines);
      polylines = [];
    }
    container.querySelector(".local-route-layer")?.remove();
  }

  function updateAmap(state: AppState) {
    if (!map || !amap) return;
    clearAmap();
    const points = getMarkerPoints(state);
    markers = points.map((point) => new amap.Marker({
      position: [point.lng, point.lat],
      content: markerContent(point),
      offset: new amap.Pixel(-16, -34),
      title: point.name
    }));
    if (markers.length) map.add(markers);

    const paths = getRoutePaths(state, points);
    const colors = routeColors;
    polylines = paths
      .filter((route) => route.length > 1)
      .map((route, index) => new amap.Polyline({
        path: route.map((point) => [point.lng, point.lat]),
        strokeColor: colors[index % colors.length],
        strokeWeight: 7,
        strokeOpacity: 0.9,
        lineJoin: "round"
      }));
    if (polylines.length) map.add(polylines);

    const fitItems = [...markers, ...polylines];
    if (fitItems.length) map.setFitView(fitItems, false, [72, 72, 72, 72]);
  }

  function update(state: AppState) {
    latestState = state;
    if (fallback) {
      renderLocalRouteLayer(container, state, "fallback");
      return;
    }
    if (!map) return;
    updateAmap(state);
  }

  init();

  return { update };
}
