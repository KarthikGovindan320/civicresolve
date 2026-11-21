"use client";

// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT] STAFF PORTAL: city admin + department dashboards
// -----------------------------------------------------------------------------
// BRIEF ✔ Admin Dashboard: "review complaints, update statuses, and manage
// reported issues", extended into real work delegation:
//   • One sign-in, two roles. The passcode decides who you are:
//       - City admin  → every department, escalations, overrides of the AI
//       - Department  → ONLY its own queue (also enforced server-side)
//   • Work queues by stage: To accept → In progress → Awaiting citizen → Closed,
//     plus Overdue and (for the admin) Escalations: overdue, reopened by the
//     citizen, or the AI doubting a claimed fix.
//   • Sorted as a triage queue: overdue first, then priority, then number of
//     reporters, then oldest.
//   • Per ticket: accept with a promised fix date, transfer to the right
//     department with a reason, message the citizen (auto-translated), mark
//     fixed with an after photo (AI-verified), add public notes.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Stats from "@/components/Stats";
import { DEPARTMENTS, PRIORITIES, type Department, type PrivateTicket, type PublicTicket, isHeld, isPendingReview } from "@/lib/types";
import TicketCard from "./TicketCard";

const KEY = "civic-staff-key";
const sel = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
export type Session = { role: "admin" | "department"; department?: Department; label: string; gemini: boolean; email: boolean };
export type StaffTicket = PublicTicket & Partial<Pick<PrivateTicket, "messages">>;

const QUEUES = {
  todo: { label: "To accept", match: (t: StaffTicket) => t.status === "Reported" },
  doing: { label: "In progress", match: (t: StaffTicket) => t.status === "In Progress" },
  awaiting: { label: "Awaiting citizen", match: (t: StaffTicket) => t.status === "Resolved" && t.citizenConfirmation === "pending" },
  closed: { label: "Closed", match: (t: StaffTicket) => t.status === "Resolved" && t.citizenConfirmation !== "pending" },
  overdue: { label: "Overdue", match: (t: StaffTicket) => t.overdue },
  escalations: {
    label: "Escalations",
    match: (t: StaffTicket) =>
      t.overdue || (t.status !== "Resolved" && (t.reopenCount ?? 0) > 0) || (t.status === "Resolved" && t.resolution?.aiVerdict === "not_fixed" && t.citizenConfirmation === "pending"),
  },
  all: { label: "All", match: () => true },
  // [SECURITY] Admin-only bucket: reports sent WITHOUT phone verification wait here for screening.
  review: { label: "Unverified", match: (t: StaffTicket) => isPendingReview(t) },
} as const;
// Held reports appear ONLY in the review tab, never in the working queues or the statistics.
const inQueue = (q: QueueKey, t: StaffTicket) => (q === "review" ? isPendingReview(t) : !isHeld(t) && QUEUES[q].match(t));
type QueueKey = keyof typeof QUEUES;

// Triage order: overdue → priority → reporters → oldest.
const rank = (t: StaffTicket) => PRIORITIES.indexOf(t.priority);
const triage = (a: StaffTicket, b: StaffTicket) =>
  Number(b.overdue) - Number(a.overdue) || rank(b) - rank(a) || b.reporterCount - a.reporterCount || a.createdAt.localeCompare(b.createdAt);

export default function StaffPage() {
  const [key, setKey] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  // [SECURITY] The passcode is verified by the server before the dashboard
  // renders, and is kept only in sessionStorage (cleared when the tab closes).
  const tryKey = useCallback(async (k: string) => {
    const r = await fetch("/api/staff/session", { headers: { "x-staff-key": k } });
    if (!r.ok) return false;
    setSession(await r.json());
    setKey(k);
    try { sessionStorage.setItem(KEY, k); } catch {}
    return true;
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(KEY); } catch {}
    // tryKey sets state only after an async fetch, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) tryKey(saved);
  }, [tryKey]);

  if (!key || !session) return <Login onTry={tryKey} />;
  return (
    <Dashboard
      staffKey={key}
      session={session}
      onLogout={() => {
        try { sessionStorage.removeItem(KEY); } catch {}
        setKey(null);
        setSession(null);
      }}
    />
  );
}

function Login({ onTry }: { onTry: (k: string) => Promise<boolean> }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState(false);
  return (
    <form
      onSubmit={async (e) => { e.preventDefault(); setErr(!(await onTry(v))); }}
      className="mx-auto mt-10 max-w-sm space-y-3 rounded-xl bg-white p-6 ring-1 ring-slate-200"
    >
      <h1 className="text-xl font-semibold">Staff sign-in</h1>
      <p className="text-sm text-slate-600">City admin or department staff. Your passcode decides which queue you see.</p>
      <label htmlFor="pass" className="block text-sm font-medium">Passcode</label>
      <input id="pass" type="password" value={v} onChange={(e) => setV(e.target.value)} autoFocus autoComplete="current-password"
        className="w-full rounded-md border border-slate-300 px-3 py-2" />
      {err && <p role="alert" className="text-sm text-red-700">Wrong passcode.</p>}
      <button className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white">Sign in</button>
    </form>
  );
}

function Dashboard({ staffKey, session, onLogout }: { staffKey: string; session: Session; onLogout: () => void }) {
  const isAdmin = session.role === "admin";
  const [tickets, setTickets] = useState<StaffTicket[] | null>(null);
  const [queue, setQueue] = useState<QueueKey>(isAdmin ? "escalations" : "todo");
  const [dept, setDept] = useState<string>("all");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tickets", { headers: { "x-staff-key": staffKey } })
      .then((r) => r.json())
      .then(setTickets);
  }, [staffKey]);

  // A department works only on its own tickets; the admin can narrow by department.
  const scoped = useMemo(
    () =>
      (tickets ?? []).filter((t) =>
        isAdmin ? dept === "all" || t.department === dept : t.department === session.department,
      ),
    [tickets, isAdmin, dept, session.department],
  );
  const shown = useMemo(() => scoped.filter((t) => inQueue(queue, t)).sort(triage), [scoped, queue]);
  const live = useMemo(() => scoped.filter((t) => !isHeld(t)), [scoped]);
  const queues = (Object.keys(QUEUES) as QueueKey[]).filter((q) => isAdmin || (q !== "escalations" && q !== "review"));

  // Swap in the server's response, so the UI always shows server-validated data.
  const replace = (t: StaffTicket) => setTickets((ts) => ts!.map((x) => (x.id === t.id ? t : x)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{isAdmin ? "City admin dashboard" : `${session.label}: work queue`}</h1>
          <p className="text-sm text-slate-600">
            {isAdmin ? "All departments. Escalations need your attention first." : "Issues routed to your department. Overdue and highest priority first."}
          </p>
          {!session.gemini && <p className="text-sm font-medium text-amber-800">Gemini key not set: using rule-based fallback.</p>}
        </div>
        <button onClick={onLogout} className="text-sm text-slate-700 underline">Sign out</button>
      </div>

      {tickets && <Stats tickets={live} />}

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Work queues" className="flex flex-wrap gap-1 rounded-lg bg-slate-200 p-1">
          {queues.map((q) => {
            const n = scoped.filter((t) => inQueue(q, t)).length;
            return (
              <button
                key={q}
                role="tab"
                aria-selected={queue === q}
                onClick={() => setQueue(q)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${queue === q ? "bg-white shadow-sm" : "text-slate-700"}`}
              >
                {QUEUES[q].label} <span className="tabular-nums text-slate-600">({n})</span>
              </button>
            );
          })}
        </div>
        {isAdmin && (
          <label className="text-sm">Department{" "}
            <select className={sel} value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="all">All</option>
              {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
        )}
        <span role="status" className="ml-auto text-sm text-emerald-700">{msg}</span>
      </div>

      {!tickets && <p className="text-slate-600">Loading…</p>}
      <ul className="space-y-3" role="tabpanel" aria-label={QUEUES[queue].label}>
        {shown.map((t) => (
          <TicketCard key={t.id} t={t} staffKey={staffKey} isAdmin={isAdmin} onUpdated={(u, m) => { replace(u); setMsg(m); }} />
        ))}
        {tickets && !shown.length && <li className="rounded-lg bg-white p-6 text-center text-slate-600 ring-1 ring-slate-200">Nothing in this queue. 🎉</li>}
      </ul>
    </div>
  );
}
