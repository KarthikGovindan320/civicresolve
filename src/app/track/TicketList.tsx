"use client";

import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { OverdueBadge, PriorityBadge, StatusBadge } from "@/components/badges";
import { formatDateTime } from "@/lib/format";
import type { PublicTicket } from "@/lib/types";

/**
 * The public ticket list: one link per ticket to its tracking page. Titles are
 * shown as the citizen wrote them and department names as stored (English),
 * each marked with its own language.
 */
export default function TicketList({ tickets }: { tickets: PublicTicket[] }) {
  const t = useT();
  return (
    <ul className="divide-y divide-slate-200 rounded-lg bg-white ring-1 ring-slate-200">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <Link
            href={`/track/${ticket.id}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50"
          >
            <span className="font-mono text-xs text-slate-600">{ticket.id}</span>
            <span lang={ticket.originalLanguage} className="min-w-[12rem] flex-1 font-medium">
              {ticket.title}
            </span>
            {/* Badges stay together as one group when the row wraps on a phone. */}
            <span className="flex max-w-full flex-wrap items-center gap-2">
              {ticket.reporterCount > 1 && (
                <span className="text-xs text-slate-600">{t("common.reporters", { count: ticket.reporterCount })}</span>
              )}
              <PriorityBadge priority={ticket.priority} />
              <StatusBadge status={ticket.status} />
              {ticket.overdue && <OverdueBadge />}
            </span>
            <span className="w-full text-xs text-slate-600">
              {t(`category.${ticket.category}`)} · <span lang="en">{ticket.department}</span> ·{" "}
              {ticket.location.address || t("common.pinnedLocation")} · {formatDateTime(ticket.createdAt)}
            </span>
          </Link>
        </li>
      ))}
      {!tickets.length && <li className="px-4 py-6 text-center text-slate-600">{t("track.noMatch")}</li>}
    </ul>
  );
}
