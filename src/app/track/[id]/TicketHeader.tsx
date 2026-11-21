import { OverdueBadge, PriorityBadge, StatusBadge } from "@/components/badges";
import { formatDateTime } from "@/lib/client/format";
import type { Translate } from "@/lib/i18n";
import type { PublicTicket } from "@/lib/types";

/** Ticket id, title, place and report time, with the priority, status and overdue badges. */
export default function TicketHeader({ ticket, t }: { ticket: PublicTicket; t: Translate }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-mono text-sm text-slate-600">{ticket.id}</p>
        <h1 className="text-2xl font-semibold">{ticket.title}</h1>
        <p className="text-sm text-slate-600">
          {ticket.location.address || t("common.pinnedLocation")} ·{" "}
          {t("ticket.reportedAt", { when: formatDateTime(ticket.createdAt) })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <PriorityBadge priority={ticket.priority} />
        <StatusBadge status={ticket.status} />
        {ticket.overdue && <OverdueBadge />}
      </div>
    </div>
  );
}
