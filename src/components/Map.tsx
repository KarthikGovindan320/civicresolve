"use client";

import dynamic from "next/dynamic";

/** Leaflet touches `window`, so the map only renders on the client. */
// [EFFICIENCY] Code-splitting: Leaflet (~150 KB) is downloaded only on pages that show a map,
// with a skeleton placeholder so the layout doesn't jump while it loads.
const Map = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="h-[380px] animate-pulse rounded-lg bg-slate-200" aria-label="Loading map" />,
});

export default Map;
