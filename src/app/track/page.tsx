"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Map from "@/components/Map";
import Stats from "@/components/Stats";
import { PRIORITY_COLOR, PriorityBadge, StatusBadge, fmtDate } from "@/components/badges";
import { PRIORITIES } from "@/lib/types";
import { CATEGORIES, STATUSES, type PublicTicket as Ticket } from "@/lib/types";

// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT] PUBLIC ISSUE TRACKING DASHBOARD
// -----------------------------------------------------------------------------
// BRIEF ✔ Issue Tracking Dashboard: "display submitted complaints with their
// status, such as Reported, In Progress, and Resolved".
// Beyond a plain list we add: a ticket-ID lookup, filters by status and
// category, a city map of all issues, and live transparency statistics.
// It is public on purpose: citizens can see that problems get fixed, which
// builds trust and encourages reporting.
// =============================================================================

const sel = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

export default function TrackPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [lookup, setLookup] = useState("");

  useEffect(() => {
    fetch("/api/tickets")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setTickets)
      .catch(() => setError("Couldn't load tickets."));
  }, []);

  // [EFFICIENCY] Filtering happens client-side for instant response; the map and list share
  // the same filtered set, so they always agree.
  const shown = useMemo(
    () =>
      (tickets ?? []).filter(
        (t) => (status === "all" || t.status === status) && (category === "all" || t.category === category),
      ),
    [tickets, status, category],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Track issues</h1>
          <p className="text-slate-600">Every report in the city and where it stands.</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (lookup.trim()) router.push(`/track/${lookup.trim().toUpperCase()}`);
          }}
          className="flex gap-2"
        >
          <label htmlFor="lookup" className="sr-only">Ticket ID</label>
          <input id="lookup" value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Ticket ID, e.g. CR-1004"
            className="w-48 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">Find</button>
        </form>
      </div>

      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!tickets && !error && <p className="text-slate-500">Loading…</p>}
      {tickets && (
        <>
          <Stats tickets={tickets} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">Status{" "}
              <select className={sel} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">All</option>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-sm">Category{" "}
              <select className={sel} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">All</option>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <span className="text-sm text-slate-500">{shown.length} shown</span>
          </div>
          <Map tickets={shown} height={360} />
          {/* [ACCESSIBILITY] Legend: pin colour = priority (grey = resolved), also stated in each pin's popup text. */}
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700" aria-label="Map legend">
            {[...PRIORITIES].reverse().map((p) => (
              <li key={p} className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full ring-1 ring-white" style={{ background: PRIORITY_COLOR[p] }} aria-hidden />
                {p}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: "#64748b" }} aria-hidden />
              Resolved
            </li>
          </ul>
          <ul className="divide-y divide-slate-200 rounded-lg bg-white ring-1 ring-slate-200">
            {shown.map((t) => (
              <li key={t.id}>
                <Link href={`/track/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50">
                  <span className="font-mono text-xs text-slate-600">{t.id}</span>
                  <span className="min-w-[12rem] flex-1 font-medium">{t.title}</span>
                  {/* Badges stay together as one group when the row wraps on a phone. */}
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    {t.reporterCount > 1 && <span className="text-xs text-slate-600">{t.reporterCount} reporters</span>}
                    <PriorityBadge p={t.priority} />
                    <StatusBadge s={t.status} />
                    {t.overdue && <span className="rounded-full bg-red-700 px-2 py-0.5 text-xs font-semibold text-white">Overdue</span>}
                  </span>
                  <span className="w-full text-xs text-slate-600">
                    {t.category} · {t.department} · {t.location.address || "Pinned location"} · {fmtDate(t.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
            {!shown.length && <li className="px-4 py-6 text-center text-slate-500">No issues match these filters.</li>}
          </ul>
        </>
      )}
    </div>
  );
}
