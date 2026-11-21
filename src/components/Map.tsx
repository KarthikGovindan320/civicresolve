"use client";

import dynamic from "next/dynamic";
import { useT } from "./I18nProvider";

/** Placeholder with the map's default height, shown while Leaflet downloads. */
function MapSkeleton() {
  const t = useT();
  return <div className="h-[380px] animate-pulse rounded-lg bg-slate-200" role="img" aria-label={t("map.loading")} />;
}

/**
 * Client-only wrapper around MapView. Leaflet touches `window`, so it cannot
 * render on the server; loading it dynamically also means its ~150 KB is
 * downloaded only on pages that show a map. A skeleton placeholder keeps the
 * layout from jumping while it loads.
 */
const Map = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

export default Map;
