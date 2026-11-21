"use client";

import dynamic from "next/dynamic";
import { createContext, useContext } from "react";
import { useT } from "./I18nProvider";
import type { MapViewProps } from "./MapView";
import { DEFAULT_MAP_HEIGHT } from "./ui";

/** Carries the requested height to the skeleton, whose `loading` callback receives no props. */
const MapHeight = createContext(DEFAULT_MAP_HEIGHT);

/** Placeholder with the map's own height, shown while Leaflet downloads. */
function MapSkeleton() {
  const t = useT();
  const height = useContext(MapHeight);
  return (
    <div
      className="animate-pulse rounded-lg bg-slate-200"
      style={{ height }}
      role="img"
      aria-label={t("map.loading")}
    />
  );
}

const LazyMapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

/**
 * Client-only wrapper around MapView. Leaflet touches `window`, so it cannot
 * render on the server; loading it dynamically also means its ~150 KB is
 * downloaded only on pages that show a map. A skeleton of the same height
 * keeps the layout from jumping while it loads.
 */
export default function Map(props: MapViewProps) {
  return (
    <MapHeight.Provider value={props.height ?? DEFAULT_MAP_HEIGHT}>
      <LazyMapView {...props} />
    </MapHeight.Provider>
  );
}
