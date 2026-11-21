import { formatDateTime, formatDay } from "@/lib/format";
import type { Translate } from "@/lib/i18n";
import type { PublicTicket } from "@/lib/types";

/** Accountability strip: who owns the ticket, when they accepted it, and by when it should be fixed. */
export default function AccountabilityStrip({ ticket, t }: { ticket: PublicTicket; t: Translate }) {
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-white p-4 text-sm ring-1 ring-slate-200 md:grid-cols-4">
      <div>
        <dt className="text-slate-600">{t("ticket.responsible")}</dt>
        <dd className="font-medium" lang="en">
          {ticket.department}
        </dd>
      </div>
      <div>
        <dt className="text-slate-600">{t("ticket.accepted")}</dt>
        <dd className="font-medium">
          {ticket.acknowledgedAt ? formatDateTime(ticket.acknowledgedAt) : t("ticket.notYet")}
        </dd>
      </div>
      <div>
        <dt className="text-slate-600">{t("ticket.promisedDate")}</dt>
        <dd className="font-medium">
          {ticket.expectedFixDate ? formatDay(ticket.expectedFixDate) : t("ticket.notSet")}
        </dd>
      </div>
      <div>
        <dt className="text-slate-600">{t("ticket.target")}</dt>
        <dd className={`font-medium ${ticket.overdue ? "text-red-700" : ""}`}>
          {formatDateTime(ticket.slaDueAt)}
          {ticket.overdue ? ` · ${t("ticket.overdueSuffix")}` : ""}
        </dd>
      </div>
    </dl>
  );
}
