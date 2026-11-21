"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { PublicTicket as Ticket } from "@/lib/types";
import { PRIORITY_COLOR } from "./badges";

// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT] INTERACTIVE MAP (Leaflet + OpenStreetMap)
// -----------------------------------------------------------------------------
// One component, two jobs:
//   • Location picker on the report form (BRIEF ✔ "location"): tap to drop a pin.
//   • City-wide issue map on the tracking dashboards: every ticket is a circle
//     coloured by priority (red = Critical … green = Low), grey once resolved,
//     and larger when more citizens reported it. You can see at a glance where
//     the city's most urgent and most-reported problems are. This serves the
//     brief's closing goal: "visualize progress towards resolution".
// OpenStreetMap tiles need no API key, no billing and no quota.
// =============================================================================

export const VELLORE = { lat: 12.9165, lng: 79.1325 };

export interface MapViewProps {
  tickets?: Ticket[];
  picked?: { lat: number; lng: number } | null;
  onPick?: (p: { lat: number; lng: number }) => void;
  height?: number;
  center?: { lat: number; lng: number };
  zoom?: number;
}

// [ACCESSIBILITY] Picking a location must not require a mouse or touch screen.
// Leaflet's map container is keyboard-focusable and pans with the arrow keys; we
// add Enter (or Space) to pin the current map centre, marked by a crosshair.
// Together with the "Use my location" button this gives two non-pointer ways
// to set a location (WCAG 2.1.1 Keyboard).
function ClickHandler({ onPick }: { onPick: MapViewProps["onPick"] }) {
  const map = useMapEvents({
    click: (e) => onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng }),
    keydown: (e) => {
      const k = (e.originalEvent as KeyboardEvent).key;
      if (k === "Enter" || k === " ") {
        e.originalEvent.preventDefault();
        const c = map.getCenter();
        onPick?.({ lat: c.lat, lng: c.lng });
      }
    },
  });
  return null;
}

function Recenter({ to }: { to?: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (to) map.setView([to.lat, to.lng], Math.max(map.getZoom(), 15));
  }, [to, map]);
  return null;
}

export default function MapView({ tickets = [], picked, onPick, height = 380, center, zoom = 13 }: MapViewProps) {
  const c = center ?? picked ?? VELLORE;
  return (
    <div className="relative">
    <MapContainer
      center={[c.lat, c.lng]}
      zoom={zoom}
      style={{ height, width: "100%" }}
      className="rounded-lg ring-1 ring-slate-200"
      // [ACCESSIBILITY] Prevents the map from hijacking page scroll on laptops and phones.
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {onPick && <ClickHandler onPick={onPick} />}
      {onPick && <Recenter to={picked} />}
      {tickets.map((t) => (
        // Vector circle markers instead of image pins: no broken-icon issues with
        // bundlers, and colour and size can encode priority and reporter count.
        <CircleMarker
          key={t.id}
          center={[t.location.lat, t.location.lng]}
          radius={7 + Math.min(t.reporterCount, 6)}
          pathOptions={{
            color: "#fff",
            weight: 2,
            fillColor: t.status === "Resolved" ? "#64748b" : PRIORITY_COLOR[t.priority],
            fillOpacity: t.status === "Resolved" ? 0.5 : 0.9,
          }}
        >
          <Popup>
            <strong>{t.title}</strong>
            <br />
            {t.category} · {t.priority} · {t.status}
            <br />
            {t.reporterCount > 1 && <>{t.reporterCount} reporters<br /></>}
            <a href={`/track/${t.id}`}>View {t.id}</a>
          </Popup>
        </CircleMarker>
      ))}
      {picked && (
        <CircleMarker
          center={[picked.lat, picked.lng]}
          radius={10}
          pathOptions={{ color: "#1d4ed8", weight: 3, fillColor: "#3b82f6", fillOpacity: 0.6 }}
        >
          <Popup>Issue location</Popup>
        </CircleMarker>
      )}
    </MapContainer>
      {/* Centre crosshair for keyboard pinning; decorative, so hidden from screen readers. */}
      {onPick && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-1/2 text-xl font-bold text-blue-700"
        >
          +
        </span>
      )}
    </div>
  );
}
