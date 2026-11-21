"use client";

import { useT } from "@/components/I18nProvider";
import { PRIORITY_COLOR, RESOLVED_COLOR } from "@/components/badges";
import { PRIORITIES } from "@/lib/types";

/** Legend of the city map: pin colour means priority (grey once resolved). Each pin's popup also states it in text. */
export default function MapLegend() {
  const t = useT();
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700" aria-label={t("track.legend")}>
      {[...PRIORITIES].reverse().map((priority) => (
        <li key={priority} className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full ring-1 ring-white"
            style={{ background: PRIORITY_COLOR[priority] }}
            aria-hidden
          />
          {t(`priority.${priority}`)}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: RESOLVED_COLOR }} aria-hidden />
        {t("status.Resolved")}
      </li>
    </ul>
  );
}
