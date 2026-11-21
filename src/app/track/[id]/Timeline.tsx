import { StatusBadge } from "@/components/badges";
import { formatDateTime } from "@/lib/format";
import type { Translate } from "@/lib/i18n";
import type { HistoryEntry } from "@/lib/types";

/** Dated timeline of every status change, department hand-off and note on the ticket. */
export default function Timeline({ history, t }: { history?: HistoryEntry[]; t: Translate }) {
  return (
    <div className="rounded-lg bg-white p-5 ring-1 ring-slate-200">
      <h2 className="mb-3 font-semibold">{t("ticket.timeline")}</h2>
      <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
        {(history ?? []).map((entry, index) => (
          <li key={index} className="relative">
            <span
              aria-hidden
              className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-emerald-600 ring-4 ring-white"
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge status={entry.status} />
              <time className="text-slate-600" dateTime={entry.at}>
                {formatDateTime(entry.at)}
              </time>
            </div>
            {/* Notes are written by staff and the system, in English. */}
            {entry.note && (
              <p lang="en" className="mt-1 text-sm text-slate-700">
                {entry.note}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
