import { OverdueBadge, Pill, PriorityBadge, StatusBadge } from "@/components/badges";
import { formatDateTime, formatDay, languageName } from "@/lib/client/format";
import type { StaffTicket } from "./types";

/**
 * The always-visible header of a staff ticket card: identity, warning flags,
 * priority and status, the English summary, and the dates the department is
 * held to.
 */
export default function TicketSummary({ ticket, showDepartment }: { ticket: StaffTicket; showDepartment: boolean }) {
  const isResolved = ticket.status === "Resolved";
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-xs text-slate-600">{ticket.id}</span>
        <span className="min-w-[12rem] flex-1 font-medium">{ticket.title}</span>
        {ticket.overdue && <OverdueBadge />}
        {(ticket.reopenCount ?? 0) > 0 && !isResolved && <Pill tone="red">Reopened ×{ticket.reopenCount}</Pill>}
        {ticket.resolution?.aiVerdict === "not_fixed" && isResolved && <Pill tone="red">AI doubts fix</Pill>}
        {ticket.reporterCount > 1 && <Pill tone="amber">{ticket.reporterCount} reporters</Pill>}
        {ticket.messageCount > 0 && <span className="text-xs text-slate-600">💬 {ticket.messageCount}</span>}
        <PriorityBadge priority={ticket.priority} />
        <StatusBadge status={ticket.status} />
      </div>
      <p className="mt-1 text-sm text-slate-700">{ticket.englishSummary}</p>
      <p className="mt-0.5 text-xs text-slate-600">
        {showDepartment && <>{ticket.department} · </>}
        Target {formatDateTime(ticket.slaDueAt)}
        {ticket.expectedFixDate && <> · promised by {formatDay(ticket.expectedFixDate)}</>} ·{" "}
        {languageName(ticket.originalLanguage)} · {ticket.location.address || "Pinned"}
        {ticket.classifiedBy === "fallback" && " · ⚠ rule-classified, please verify"}
      </p>
    </>
  );
}
