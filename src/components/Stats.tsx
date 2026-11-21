"use client";

import { HOUR_MS } from "@/lib/constants";
import type { PublicTicket } from "@/lib/types";
import { useT } from "./I18nProvider";

const isOpen = (ticket: PublicTicket) => ticket.status !== "Resolved";
type ResolvedTicket = PublicTicket & { resolvedAt: string };
const isResolved = (ticket: PublicTicket): ticket is ResolvedTicket =>
  ticket.status === "Resolved" && Boolean(ticket.resolvedAt);

/** Percentage of resolved tickets that were fixed by their target date, or null when none are resolved yet. */
function onTimePercent(tickets: PublicTicket[]): number | null {
  const resolved = tickets.filter(isResolved);
  if (!resolved.length) return null;
  const onTime = resolved.filter((ticket) => ticket.resolvedAt <= ticket.slaDueAt).length;
  return Math.round((100 * onTime) / resolved.length);
}

/** Mean hours from report to resolution; 0 when nothing is resolved yet. */
function averageHoursToFix(resolved: ResolvedTicket[]): number {
  if (!resolved.length) return 0;
  const totalMs = resolved.reduce(
    (sum, ticket) => sum + (Date.parse(ticket.resolvedAt) - Date.parse(ticket.createdAt)),
    0,
  );
  return totalMs / resolved.length / HOUR_MS;
}

/** Per-department workload and performance, worst backlog first. */
function departmentRows(tickets: PublicTicket[]) {
  return [...new Set(tickets.map((ticket) => ticket.department))]
    .map((department) => {
      const departmentTickets = tickets.filter((ticket) => ticket.department === department);
      return {
        department,
        open: departmentTickets.filter(isOpen).length,
        overdue: departmentTickets.filter((ticket) => ticket.overdue).length,
        onTime: onTimePercent(departmentTickets),
      };
    })
    .sort((first, second) => second.overdue - first.overdue || second.open - first.open);
}

/**
 * Transparency and accountability statistics, shown to citizens on /track and
 * to staff on /staff. It answers the questions a resident (or a commissioner)
 * actually asks: how many problems are open, how many are dangerous, how many
 * are past their deadline, do things get fixed, how fast and on time, and
 * which department is falling behind. Everything is computed live from the
 * ticket list, with no separate analytics store.
 */
export default function Stats({ tickets }: { tickets: PublicTicket[] }) {
  const t = useT();
  const open = tickets.filter(isOpen);
  const resolved = tickets.filter(isResolved);
  const critical = open.filter((ticket) => ticket.priority === "Critical").length;
  const overdue = open.filter((ticket) => ticket.overdue).length;
  const avgHours = averageHoursToFix(resolved);
  const allOnTime = onTimePercent(tickets);
  const departments = departmentRows(tickets);
  // The longest bar represents the department with the most open issues.
  const maxOpen = Math.max(1, ...departments.map((row) => row.open));

  return (
    <section aria-label={t("stats.label")} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label={t("stats.open")} value={open.length} />
        <Tile label={t("stats.critical")} value={critical} accent={critical ? "text-red-700" : undefined} />
        <Tile label={t("stats.overdue")} value={overdue} accent={overdue ? "text-red-700" : undefined} />
        <Tile label={t("stats.resolved")} value={resolved.length} />
        <Tile
          label={t("stats.avgTime")}
          value={
            avgHours >= 48
              ? t("stats.days", { value: (avgHours / 24).toFixed(1) })
              : t("stats.hours", { value: avgHours.toFixed(1) })
          }
        />
        <Tile label={t("stats.onTime")} value={allOnTime === null ? "–" : `${allOnTime}%`} />
      </div>
      <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <h2 className="text-xs font-medium uppercase tracking-wide text-slate-600">{t("stats.departments")}</h2>
        {/* On a phone each department becomes a small block (name, then its numbers) so long
            translated labels never push the table off screen. The explicit roles keep it a
            table for screen readers even where the rows are laid out with flexbox. */}
        <table role="table" className="mt-2 w-full text-xs">
          <thead className="sr-only">
            <tr role="row">
              <th role="columnheader">{t("stats.colDepartment")}</th>
              <th role="columnheader">{t("stats.open")}</th>
              <th role="columnheader">{t("stats.overdue")}</th>
              <th role="columnheader">{t("stats.colOnTime")}</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((row) => (
              <tr
                key={row.department}
                role="row"
                className="flex flex-wrap items-center gap-x-3 border-slate-100 py-1 max-sm:border-t sm:table-row sm:py-0"
              >
                <th
                  scope="row"
                  role="rowheader"
                  lang="en"
                  className="w-full pr-2 text-left font-medium sm:w-48 sm:py-1 sm:font-normal"
                >
                  {row.department}
                </th>
                <td role="cell" className="min-w-32 flex-1 sm:py-1">
                  <span className="flex items-center gap-2">
                    <span className="h-2 min-w-8 flex-1 rounded bg-slate-100" aria-hidden>
                      <span
                        className="block h-2 rounded bg-emerald-600"
                        style={{ width: `${(row.open / maxOpen) * 100}%` }}
                      />
                    </span>
                    <span className="min-w-14 whitespace-nowrap tabular-nums">
                      {t("stats.rowOpen", { count: row.open })}
                    </span>
                  </span>
                </td>
                <td
                  role="cell"
                  className={`whitespace-nowrap text-right tabular-nums sm:py-1 sm:pl-2 ${row.overdue ? "font-semibold text-red-700" : "text-slate-600"}`}
                >
                  {t("stats.rowOverdue", { count: row.overdue })}
                </td>
                <td role="cell" className="whitespace-nowrap text-right tabular-nums text-slate-700 sm:py-1 sm:pl-2">
                  {row.onTime === null ? "–" : t("stats.rowOnTime", { percent: row.onTime })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Tile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ?? ""}`}>{value}</div>
    </div>
  );
}
