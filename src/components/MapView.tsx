"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { PublicTicket } from "@/lib/types";
import { useT } from "./I18nProvider";
import { PRIORITY_COLOR, RESOLVED_COLOR } from "./badges";

interface Coordinates {
  lat: number;
  lng: number;
}

/** Where the map opens when no location is given: the centre of Vellore. */
export const VELLORE: Coordinates = { lat: 12.9165, lng: 79.1325 };

/** Zoom level close enough to tell neighbouring streets apart when jumping to a picked location. */
const STREET_ZOOM = 15;

export interface MapViewProps {
  /** Issues to plot as priority-coloured circles. */
  tickets?: PublicTicket[];
  /** The location chosen on the report form, shown as a blue pin. */
  picked?: Coordinates | null;
  /** Makes the map a location picker: called when the user clicks or presses Enter. */
  onPick?: (location: Coordinates) => void;
  height?: number;
  center?: Coordinates;
  zoom?: number;
}

/**
 * Turns clicks and key presses into picked locations. Picking must not need a
 * mouse or touch screen: Leaflet's map container is keyboard-focusable and
 * pans with the arrow keys, and this adds Enter (or Space) to pin the current
 * map centre, marked by a crosshair. Together with the "Use my location"
 * button that gives two non-pointer ways to set a location (WCAG 2.1.1).
 */
function PickHandler({ onPick }: { onPick: MapViewProps["onPick"] }) {
  const map = useMapEvents({
    click: (event) => onPick?.({ lat: event.latlng.lat, lng: event.latlng.lng }),
    keydown: (event) => {
      const { key } = event.originalEvent as KeyboardEvent;
      if (key === "Enter" || key === " ") {
        event.originalEvent.preventDefault();
        const mapCentre = map.getCenter();
        onPick?.({ lat: mapCentre.lat, lng: mapCentre.lng });
      }
    },
  });
  return null;
}

/** Moves the map to a newly picked location (from GPS or address search), zooming in if needed. */
function Recenter({ target }: { target?: Coordinates | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView([target.lat, target.lng], Math.max(map.getZoom(), STREET_ZOOM));
  }, [target, map]);
  return null;
}

/**
 * Interactive map (Leaflet with OpenStreetMap tiles, which need no API key,
 * billing or quota). One component, two jobs:
 *   - Location picker on the report form: tap to drop a pin.
 *   - City-wide issue map on the tracking pages: every ticket is a circle
 *     coloured by priority (red = Critical ... green = Low), grey once
 *     resolved, and larger when more citizens reported it, so the most urgent
 *     and most-reported problems stand out at a glance.
 */
export default function MapView({ tickets = [], picked, onPick, height = 380, center, zoom = 13 }: MapViewProps) {
  const t = useT();
  const initialCentre = center ?? picked ?? VELLORE;
  return (
    <div className="relative">
      <MapContainer
        center={[initialCentre.lat, initialCentre.lng]}
        zoom={zoom}
        style={{ height, width: "100%" }}
        className="rounded-lg ring-1 ring-slate-200"
        // Keeps the map from hijacking page scroll on laptops and phones.
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {onPick && <PickHandler onPick={onPick} />}
        {onPick && <Recenter target={picked} />}
        {tickets.map((ticket) => (
          // Vector circle markers instead of image pins: no broken-icon issues with
          // bundlers, and colour and size can encode priority and reporter count.
          <CircleMarker
            key={ticket.id}
            center={[ticket.location.lat, ticket.location.lng]}
            radius={7 + Math.min(ticket.reporterCount, 6)}
            pathOptions={{
              color: "#fff",
              weight: 2,
              fillColor: ticket.status === "Resolved" ? RESOLVED_COLOR : PRIORITY_COLOR[ticket.priority],
              fillOpacity: ticket.status === "Resolved" ? 0.5 : 0.9,
            }}
          >
            <Popup>
              <strong>{ticket.title}</strong>
              <br />
              {t(`category.${ticket.category}`)} · {t(`priority.${ticket.priority}`)} · {t(`status.${ticket.status}`)}
              <br />
              {ticket.reporterCount > 1 && (
                <>
                  {t("common.reporters", { count: ticket.reporterCount })}
                  <br />
                </>
              )}
              <a href={`/track/${ticket.id}`}>{t("map.view", { id: ticket.id })}</a>
            </Popup>
          </CircleMarker>
        ))}
        {picked && (
          <CircleMarker
            center={[picked.lat, picked.lng]}
            radius={10}
            pathOptions={{ color: "#1d4ed8", weight: 3, fillColor: "#3b82f6", fillOpacity: 0.6 }}
          >
            <Popup>{t("map.issueLocation")}</Popup>
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
