"use client";

import { useEffect, useMemo, useState } from "react";
import Stats from "@/components/Stats";
import { compactFieldClass } from "@/components/ui";
import { staffRequest } from "@/lib/client/api";
import { DEPARTMENTS, isHeld } from "@/lib/types";
import { QUEUES, type QueueKey, byTriageOrder, inQueue, queuesFor } from "./queues";
import TicketCard from "./TicketCard";
import type { Session, StaffTicket } from "./types";

/**
 * The signed-in staff dashboard: statistics, work-queue tabs and the ticket
 * cards of the selected queue, in triage order. A department sees only its
 * own tickets; the city admin sees every department and can narrow to one.
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
  const isAdmin = session.role === "admin";
  const [tickets, setTickets] = useState<StaffTicket[] | null>(null);
  const [activeQueue, setActiveQueue] = useState<QueueKey>(isAdmin ? "escalations" : "todo");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [confirmation, setConfirmation] = useState<string | null>(null);

  useEffect(() => {
    staffRequest<StaffTicket[]>("/api/tickets", staffKey).then((result) => {
      if (result.ok) setTickets(result.data);
    });
  }, [staffKey]);

  // A department works only on its own tickets; the admin can narrow by department.
  const inScope = useMemo(
    () =>
      (tickets ?? []).filter((ticket) =>
        isAdmin
          ? departmentFilter === "all" || ticket.department === departmentFilter
          : ticket.department === session.department,
      ),
    [tickets, isAdmin, departmentFilter, session.department],
  );
  const queueTickets = useMemo(
    () => inScope.filter((ticket) => inQueue(activeQueue, ticket)).sort(byTriageOrder),
    [inScope, activeQueue],
  );
  // Held reports are excluded from the statistics until an admin approves them.
  const liveTickets = useMemo(() => inScope.filter((ticket) => !isHeld(ticket)), [inScope]);

  // Swap in the server's response, so the UI always shows server-validated data.
  function handleUpdated(updated: StaffTicket, message: string) {
    setTickets((current) => (current ?? []).map((ticket) => (ticket.id === updated.id ? updated : ticket)));
    setConfirmation(message);
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
        <button onClick={onLogout} className="text-sm text-slate-700 underline">
          Sign out
        </button>
      </div>

      {tickets && <Stats tickets={liveTickets} />}

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Work queues" className="flex flex-wrap gap-1 rounded-lg bg-slate-200 p-1">
          {queuesFor(isAdmin).map((queue) => (
            <button
              key={queue}
              role="tab"
              aria-selected={activeQueue === queue}
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
        <span role="status" className="ml-auto text-sm text-emerald-700">
          {confirmation}
        </span>
      </div>

      {!tickets && <p className="text-slate-600">Loading…</p>}
      <ul className="space-y-3" role="tabpanel" aria-label={QUEUES[activeQueue].label}>
        {queueTickets.map((ticket) => (
          <TicketCard key={ticket.id} ticket={ticket} staffKey={staffKey} isAdmin={isAdmin} onUpdated={handleUpdated} />
        ))}
        {tickets && !queueTickets.length && (
          <li className="rounded-lg bg-white p-6 text-center text-slate-600 ring-1 ring-slate-200">
            Nothing in this queue. 🎉
          </li>
        )}
      </ul>
    </div>
  );
}
