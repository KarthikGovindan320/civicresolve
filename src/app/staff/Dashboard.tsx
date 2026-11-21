"use client";

import { useEffect, useRef, useState } from "react";
import Stats from "@/components/Stats";
import { compactFieldClass } from "@/components/ui";
import { useT } from "@/components/I18nProvider";
import { failureMessages, settle, staffRequest } from "@/lib/client/api";
import { DEPARTMENTS, isHeld } from "@/lib/types";
import { QUEUES, type QueueKey, byTriageOrder, inQueue, queuesFor } from "./queues";
import TicketCard from "./TicketCard";
import type { Session, StaffTicket } from "./types";

/**
 * The signed-in staff dashboard: statistics, the work-queue switcher and the
 * ticket cards of the selected queue, in triage order. A department sees only
 * its own tickets; the city admin sees every department and can narrow to one.
 */
export default function Dashboard({
  staffKey,
  session,
  onLogout,
}: {
  staffKey: string;
  session: Session;
  onLogout: () => void;
}) {
  const t = useT();
  const isAdmin = session.role === "admin";
  const [tickets, setTickets] = useState<StaffTicket[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeQueue, setActiveQueue] = useState<QueueKey>(isAdmin ? "escalations" : "todo");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // Where focus goes when an action moves the focused card out of the queue on screen.
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    settle(staffRequest<StaffTicket[]>("/api/tickets", staffKey), failureMessages(t, "track.loadError")).then(
      (outcome) => (outcome.ok ? setTickets(outcome.data) : setLoadError(outcome.error)),
    );
  }, [staffKey, t]);

  // A department works only on its own tickets; the admin can narrow by department.
  const isInScope = (ticket: StaffTicket) =>
    isAdmin
      ? departmentFilter === "all" || ticket.department === departmentFilter
      : ticket.department === session.department;
  const inScope = (tickets ?? []).filter(isInScope);
  const queueTickets = inScope.filter((ticket) => inQueue(activeQueue, ticket)).sort(byTriageOrder);
  // Held reports are excluded from the statistics until an admin approves them.
  const liveTickets = inScope.filter((ticket) => !isHeld(ticket));

  // Swap in the server's response, so the UI always shows server-validated data.
  function handleUpdated(updated: StaffTicket, message: string) {
    setTickets((current) => (current ?? []).map((ticket) => (ticket.id === updated.id ? updated : ticket)));
    setConfirmation(message);
    // The card is about to disappear with the focus inside it; keep keyboard users on the outcome instead of <body>.
    if (!isInScope(updated) || !inQueue(activeQueue, updated)) statusRef.current?.focus();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {isAdmin ? "City admin dashboard" : `${session.label}: work queue`}
          </h1>
          <p className="text-sm text-slate-600">
            {isAdmin
              ? "All departments. Escalations need your attention first."
              : "Issues routed to your department. Overdue and highest priority first."}
          </p>
          {!session.gemini && (
            <p className="text-sm font-medium text-amber-800">Gemini key not set: using rule-based fallback.</p>
          )}
        </div>
        <button onClick={onLogout} className="inline-flex min-h-6 items-center text-sm text-slate-700 underline">
          Sign out
        </button>
      </div>

      {loadError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {loadError}
        </p>
      )}
      {!tickets && !loadError && <p className="text-slate-600">Loading…</p>}
      {tickets && (
        <>
          <Stats tickets={liveTickets} />

          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Work queues" className="flex flex-wrap gap-1 rounded-lg bg-slate-200 p-1">
              {queuesFor(isAdmin).map((queue) => (
                <button
                  key={queue}
                  type="button"
                  aria-pressed={activeQueue === queue}
                  onClick={() => setActiveQueue(queue)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${activeQueue === queue ? "bg-white shadow-sm" : "text-slate-700"}`}
                >
                  {QUEUES[queue].label}{" "}
                  <span className="tabular-nums text-slate-600">
                    ({inScope.filter((ticket) => inQueue(queue, ticket)).length})
                  </span>
                </button>
              ))}
            </div>
            {isAdmin && (
              <label className="text-sm">
                Department{" "}
                <select
                  className={compactFieldClass}
                  value={departmentFilter}
                  onChange={(event) => setDepartmentFilter(event.target.value)}
                >
                  <option value="all">All</option>
                  {DEPARTMENTS.map((department) => (
                    <option key={department}>{department}</option>
                  ))}
                </select>
              </label>
            )}
            <p ref={statusRef} tabIndex={-1} role="status" className="ml-auto text-sm text-emerald-700">
              {confirmation}
            </p>
          </div>

          <section aria-labelledby="queue-heading" className="space-y-3">
            <h2 id="queue-heading" className="text-lg font-semibold">
              {QUEUES[activeQueue].label}
            </h2>
            <ul className="space-y-3">
              {queueTickets.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  staffKey={staffKey}
                  isAdmin={isAdmin}
                  onUpdated={handleUpdated}
                />
              ))}
              {!queueTickets.length && (
                <li className="rounded-lg bg-white p-6 text-center text-slate-600 ring-1 ring-slate-200">
                  Nothing in this queue. <span aria-hidden>🎉</span>
                </li>
              )}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
