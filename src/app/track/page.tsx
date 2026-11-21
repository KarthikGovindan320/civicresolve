"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import Map from "@/components/Map";
import Stats from "@/components/Stats";
import { OverdueBadge, PRIORITY_COLOR, PriorityBadge, RESOLVED_COLOR, StatusBadge } from "@/components/badges";
import { compactFieldClass } from "@/components/ui";
import { apiRequest } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import { CATEGORIES, PRIORITIES, STATUSES, type PublicTicket } from "@/lib/types";

/**
 * Public issue tracking dashboard: every submitted complaint with its status.
 * Beyond a plain list it offers a ticket-ID lookup, filters by status and
 * category, a city map of all issues, and live transparency statistics. It is
 * public on purpose: citizens can see that problems get fixed, which builds
 * trust and encourages reporting.
 */
export default function TrackPage() {
  const t = useT();
  const router = useRouter();
  const [tickets, setTickets] = useState<PublicTicket[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [lookupId, setLookupId] = useState("");

  useEffect(() => {
    apiRequest<PublicTicket[]>("/api/tickets")
      .then((result) => (result.ok ? setTickets(result.data) : setLoadFailed(true)))
      .catch(() => setLoadFailed(true));
  }, []);

  // Filtering happens in the browser for an instant response; the map and the
  // list share the same filtered set, so they always agree.
  const visibleTickets = useMemo(
    () =>
      (tickets ?? []).filter(
        (ticket) =>
          (statusFilter === "all" || ticket.status === statusFilter) &&
          (categoryFilter === "all" || ticket.category === categoryFilter),
      ),
    [tickets, statusFilter, categoryFilter],
  );

  function openTicket(event: React.FormEvent) {
    event.preventDefault();
    if (lookupId.trim()) router.push(`/track/${lookupId.trim().toUpperCase()}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("track.heading")}</h1>
          <p className="text-slate-600">{t("track.intro")}</p>
        </div>
        <form onSubmit={openTicket} className="flex max-w-full gap-2">
          <label htmlFor="lookup" className="sr-only">
            {t("track.lookupLabel")}
          </label>
          <input
            id="lookup"
            value={lookupId}
            onChange={(event) => setLookupId(event.target.value)}
            placeholder={t("track.lookupPlaceholder")}
            className="w-48 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <button className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            {t("track.find")}
          </button>
        </form>
      </div>

      {loadFailed && (
        <p role="alert" className="text-red-700">
          {t("track.loadError")}
        </p>
      )}
      {!tickets && !loadFailed && <p className="text-slate-500">{t("common.loading")}</p>}
      {tickets && (
        <>
          <Stats tickets={tickets} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">
              {t("track.filterStatus")}{" "}
              <select
                className={compactFieldClass}
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">{t("track.all")}</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              {t("track.filterCategory")}{" "}
              <select
                className={compactFieldClass}
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="all">{t("track.all")}</option>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {t(`category.${category}`)}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-sm text-slate-500">{t("track.shown", { count: visibleTickets.length })}</span>
          </div>
          <Map tickets={visibleTickets} height={360} />
          {/* Legend: pin colour means priority (grey once resolved). Each pin's popup also states it in text. */}
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
          <ul className="divide-y divide-slate-200 rounded-lg bg-white ring-1 ring-slate-200">
            {visibleTickets.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  href={`/track/${ticket.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50"
                >
                  <span className="font-mono text-xs text-slate-600">{ticket.id}</span>
                  <span className="min-w-[12rem] flex-1 font-medium">{ticket.title}</span>
                  {/* Badges stay together as one group when the row wraps on a phone. */}
                  <span className="flex max-w-full flex-wrap items-center gap-2">
                    {ticket.reporterCount > 1 && (
                      <span className="text-xs text-slate-600">
                        {t("common.reporters", { count: ticket.reporterCount })}
                      </span>
                    )}
                    <PriorityBadge priority={ticket.priority} />
                    <StatusBadge status={ticket.status} />
                    {ticket.overdue && <OverdueBadge />}
                  </span>
                  <span className="w-full text-xs text-slate-600">
                    {t(`category.${ticket.category}`)} · {ticket.department} ·{" "}
                    {ticket.location.address || t("common.pinnedLocation")} · {formatDateTime(ticket.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
            {!visibleTickets.length && <li className="px-4 py-6 text-center text-slate-500">{t("track.noMatch")}</li>}
          </ul>
        </>
      )}
    </div>
  );
}
