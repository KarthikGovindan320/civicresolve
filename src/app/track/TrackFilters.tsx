"use client";

import { useT } from "@/components/I18nProvider";
import { compactFieldClass } from "@/components/ui";
import { CATEGORIES, STATUSES } from "@/lib/types";

/**
 * Status and category filters for the public ticket list ("all" or one
 * value each), with the number of tickets they leave, announced politely as
 * it changes.
 */
export default function TrackFilters({
  status,
  category,
  onStatusChange,
  onCategoryChange,
  shownCount,
}: {
  status: string;
  category: string;
  onStatusChange: (status: string) => void;
  onCategoryChange: (category: string) => void;
  shownCount: number;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm">
        {t("track.filterStatus")}{" "}
        <select className={compactFieldClass} value={status} onChange={(event) => onStatusChange(event.target.value)}>
          <option value="all">{t("track.all")}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`status.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        {t("track.filterCategory")}{" "}
        <select
          className={compactFieldClass}
          value={category}
          onChange={(event) => onCategoryChange(event.target.value)}
        >
          <option value="all">{t("track.all")}</option>
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t(`category.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <p role="status" className="text-sm text-slate-600">
        {t("track.shown", { count: shownCount })}
      </p>
    </div>
  );
}
