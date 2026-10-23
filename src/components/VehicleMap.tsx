import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./VehicleMap.css";

type Coordinates = { latitude: number; longitude: number };

export type VehicleMapProps = {
  position: Coordinates | null;
  heading: number;
  events: Array<{
    id: string;
    position: Coordinates;
    severity: "warning" | "critical";
    timestamp: number;
  }>;
  route: Coordinates[];
  available: boolean;
  sourceLabel?: string;
  mapLabel?: string;
  gpsStatusLabel?: string;
  fitRoute?: boolean;
};

const MAP_BOUNDS: L.LatLngBoundsExpression = [
  [37.756, -122.455],
  [37.803, -122.383],
];
const INITIAL_CENTER: L.LatLngExpression = [37.7755, -122.4165];

// A bundled illustrated fallback keeps the route usable without tile-server access.
// GPS markers remain geographically positioned; this is not a navigation basemap.
function offlineMapImage() {
  const horizontalRoads = Array.from(
    { length: 19 },
    (_, i) => `<path d="M-200 ${i * 62} H1900"/>`,
  ).join("");
  const verticalRoads = Array.from(
    { length: 26 },
    (_, i) => `<path d="M${i * 75} -300 V1500"/>`,
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1100" viewBox="0 0 1600 1100">
    <rect width="1600" height="1100" fill="#e9e9e1"/>
    <g transform="translate(90 -40) rotate(-8 800 550)" fill="none" stroke="#fbfbf7" stroke-width="13">${horizontalRoads}${verticalRoads}</g>
    <g fill="#cbdcc5" stroke="#e4e8d9" stroke-width="5">
      <rect x="208" y="440" width="132" height="100" rx="4"/>
      <rect x="430" y="735" width="160" height="95" rx="4"/>
      <rect x="627" y="217" width="104" height="80" rx="4"/>
      <path d="M977 370 l93 -13 33 90 -98 14Z"/>
    </g>
    <path d="M156 1080 L1284 153" stroke="#f9f8ef" stroke-width="41"/>
    <path d="M156 1080 L1284 153" stroke="#d5d5ca" stroke-width="1.5"/>
    <g fill="#8c958b" font-family="Arial,sans-serif" text-anchor="middle" font-size="21" letter-spacing="3">
      <text x="450" y="405">HAYES VALLEY</text><text x="850" y="450">CIVIC CENTER</text>
      <text x="1190" y="670">SOUTH OF MARKET</text><text x="585" y="920">MISSION DISTRICT</text>
      <text x="1050" y="230">TENDERLOIN</text>
    </g>
    <g fill="#a0a398" font-family="Arial,sans-serif" text-anchor="middle" font-size="15">
      <text x="276" y="498">Alamo Square</text><text x="505" y="786">Duboce Park</text>
      <text x="746" y="641" transform="rotate(-39 746 641)">Market Street</text>
      <text x="1190" y="788" transform="rotate(-8 1190 788)">Folsom Street</text>
    </g>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const vehicleIcon = (heading: number) =>
  L.divIcon({
    className: "msd-vehicle-icon",
    html: `<div class="msd-vehicle-halo"><span class="msd-vehicle-pin" style="transform:rotate(${Number.isFinite(heading) ? heading : 0}deg)"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3 20 21 12 17 4 21Z" fill="currentColor"/></svg></span></div>`,
    iconSize: [58, 58],
    iconAnchor: [29, 29],
  });

export function VehicleMap({
  position,
  heading,
  events,
  route,
  available,
  sourceLabel = "MSD-001 · simulated vehicle",
  mapLabel = "Live GPS map of the simulated vehicle in San Francisco",
  gpsStatusLabel = "GPS connected",
  fitRoute = false,
}: VehicleMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const vehicle = useRef<L.Marker | null>(null);
  const routeLayers = useRef<L.LayerGroup | null>(null);
  const eventLayers = useRef<L.LayerGroup | null>(null);
  const following = useRef(true);
  const hasFitRoute = useRef(false);
  const currentPosition = useRef(position);
  const [offline, setOffline] = useState(true);
  const [isFollowing, setIsFollowing] = useState(true);

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, {
      center: INITIAL_CENTER,
      zoom: 14,
      minZoom: 12,
      maxZoom: 18,
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: true,
    });
    map.current = instance;
    hasFitRoute.current = false;
    L.imageOverlay(offlineMapImage(), MAP_BOUNDS, {
      opacity: 1,
      interactive: false,
    }).addTo(instance);
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
        maxZoom: 19,
        crossOrigin: true,
      },
    ).addTo(instance);
    tiles.on("tileload", () => setOffline(false));
    tiles.on("tileerror", () => setOffline(true));
    routeLayers.current = L.layerGroup().addTo(instance);
    eventLayers.current = L.layerGroup().addTo(instance);
    vehicle.current = L.marker(INITIAL_CENTER, {
      icon: vehicleIcon(0),
      zIndexOffset: 1000,
      keyboard: false,
    }).addTo(instance);
    vehicle.current.bindTooltip(sourceLabel, {
      direction: "top",
      offset: [0, -25],
    });
    instance.on("dragstart", () => {
      following.current = false;
      setIsFollowing(false);
    });
    const resize = new ResizeObserver(() => {
      instance.invalidateSize({ pan: false });
      const point = currentPosition.current;
      if (following.current && point) {
        instance.stop();
        instance.setView(
          [point.latitude, point.longitude],
          instance.getZoom(),
          { animate: false },
        );
      }
    });
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      tiles.off();
      instance.remove();
      map.current = null;
      vehicle.current = null;
      routeLayers.current = null;
      eventLayers.current = null;
    };
  }, []);

  useEffect(() => {
    currentPosition.current = position;
    if (!vehicle.current || !map.current) return;
    vehicle.current.setOpacity(available && position ? 1 : 0);
    if (!position) return;
    const coordinates: L.LatLngExpression = [
      position.latitude,
      position.longitude,
    ];
    vehicle.current.setLatLng(coordinates).setIcon(vehicleIcon(heading));
    if (following.current && available)
      map.current.panTo(coordinates, { animate: true, duration: 0.45 });
  }, [position, heading, available]);

  useEffect(() => {
    const layer = routeLayers.current;
    if (!layer) return;
    layer.clearLayers();
    const coordinates: L.LatLngExpression[] = route.map((point) => [
      point.latitude,
      point.longitude,
    ]);
    if (coordinates.length < 2) return;
    L.polyline(coordinates, {
      color: "#fff",
      weight: 9,
      opacity: 0.95,
      lineJoin: "round",
    }).addTo(layer);
    L.polyline(coordinates, {
      color: "#3a7b58",
      weight: 4,
      opacity: 0.85,
      lineJoin: "round",
    }).addTo(layer);
    L.circleMarker(coordinates[0], {
      radius: 5,
      color: "#fff",
      weight: 2,
      fillColor: "#326b4c",
      fillOpacity: 1,
    }).addTo(layer);
  }, [route]);

  useEffect(() => {
    const layer = eventLayers.current;
    if (!layer) return;
    layer.clearLayers();
    events.forEach((event) => {
      const marker = L.circleMarker(
        [event.position.latitude, event.position.longitude],
        {
          radius: 6,
          fillColor: event.severity === "critical" ? "#cf6455" : "#d7a23a",
          color: "#fff",
          weight: 2,
          fillOpacity: 1,
        },
      ).addTo(layer);
      const popup = document.createElement("div");
      popup.className = "msd-map-popup";
      const title = document.createElement("strong");
      title.textContent =
        event.severity === "critical" ? "Critical impact" : "Warning impact";
      const details = document.createElement("span");
      details.textContent = `${new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${event.position.latitude.toFixed(5)}, ${event.position.longitude.toFixed(5)}`;
      popup.append(title, details);
      marker.bindPopup(popup);
    });
  }, [events]);

  useEffect(() => {
    if (!fitRoute || hasFitRoute.current || !map.current || route.length === 0)
      return;
    const coordinates: L.LatLngExpression[] = route.map((point) => [
      point.latitude,
      point.longitude,
    ]);
    map.current.fitBounds(L.latLngBounds(coordinates), {
      padding: [35, 35],
      maxZoom: 16,
      animate: false,
    });
    hasFitRoute.current = true;
  }, [route, fitRoute]);

  const recenter = () => {
    following.current = true;
    setIsFollowing(true);
    const point = currentPosition.current;
    if (point)
      map.current?.setView(
        [point.latitude, point.longitude],
        map.current.getZoom(),
        { animate: true },
      );
  };

  return (
    <div
      className={`vehicle-map ${available ? "" : "vehicle-map--unavailable"}`}
    >
      <div
        ref={container}
        className="vehicle-map__canvas"
        role="region"
        aria-label={mapLabel}
      />
      <div className="vehicle-map__status">
        <span
          className={`map-status-dot ${available ? "" : "map-status-dot--gray"}`}
        />
        {available ? gpsStatusLabel : "GPS unavailable"}
      </div>
      <div className="vehicle-map__controls" aria-label="Map controls">
        <div className="map-zoom-buttons">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => map.current?.zoomIn()}
          >
            <span aria-hidden="true">+</span>
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => map.current?.zoomOut()}
          >
            <span aria-hidden="true">−</span>
          </button>
        </div>
        <button
          type="button"
          className={`map-recenter ${isFollowing ? "map-recenter--active" : ""}`}
          aria-label="Follow vehicle"
          aria-pressed={isFollowing}
          onClick={recenter}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
            <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
          </svg>
        </button>
      </div>
      <div className="vehicle-map__coordinates">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
        <span>
          {available && position
            ? `${position.latitude.toFixed(5)}° N, ${Math.abs(position.longitude).toFixed(5)}° W`
            : "Awaiting GPS data"}
        </span>
      </div>
      {offline && (
        <span className="vehicle-map__offline">
          Illustrated offline basemap
        </span>
      )}
    </div>
  );
}

export default VehicleMap;
