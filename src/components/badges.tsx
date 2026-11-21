"use client";

import type { ReactNode } from "react";
import type { Priority, Status } from "@/lib/types";
import { useT } from "./I18nProvider";

/**
 * Shared visual language for priority and status, used on every screen and on
 * the map, so "red = Critical" means the same thing everywhere. Badges always
 * show the text label too, so meaning never depends on colour alone. The
 * labels are shown in the interface language; the stored values stay English.
 */
export const PRIORITY_COLOR: Record<Priority, string> = {
  Critical: "#b91c1c",
  High: "#ea580c",
  Medium: "#ca8a04",
  Low: "#16a34a",
};

/** Map and legend colour for a resolved issue, whatever its priority was. */
export const RESOLVED_COLOR = "#64748b";

const PRIORITY_CLASS: Record<Priority, string> = {
  Critical: "bg-red-100 text-red-800 ring-red-300",
  High: "bg-orange-100 text-orange-800 ring-orange-300",
  Medium: "bg-yellow-100 text-yellow-900 ring-yellow-300",
  Low: "bg-green-100 text-green-800 ring-green-300",
};

const STATUS_CLASS: Record<Status, string> = {
  Reported: "bg-slate-100 text-slate-800 ring-slate-300",
  "In Progress": "bg-blue-100 text-blue-800 ring-blue-300",
  Resolved: "bg-emerald-100 text-emerald-800 ring-emerald-300",
};

const BADGE_CLASS =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap";

const PILL_TONE_CLASS = {
  red: "bg-red-100 text-red-900",
  amber: "bg-amber-100 text-amber-900",
} as const;

/** Colour-coded priority label. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  const t = useT();
  return <span className={`${BADGE_CLASS} ${PRIORITY_CLASS[priority]}`}>{t(`priority.${priority}`)}</span>;
}

/** Colour-coded lifecycle status label. */
export function StatusBadge({ status }: { status: Status }) {
  const t = useT();
  return <span className={`${BADGE_CLASS} ${STATUS_CLASS[status]}`}>{t(`status.${status}`)}</span>;
}

/** Solid red marker for a ticket past its target date. */
export function OverdueBadge() {
  const t = useT();
  return (
    <span className="whitespace-nowrap rounded-full bg-red-700 px-2 py-0.5 text-xs font-semibold text-white">
      {t("badge.overdue")}
    </span>
  );
}

/** Soft-coloured pill for a secondary flag on a ticket, such as "Reopened" or a reporter count. */
export function Pill({ tone, children }: { tone: keyof typeof PILL_TONE_CLASS; children: ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PILL_TONE_CLASS[tone]}`}>{children}</span>;
}
