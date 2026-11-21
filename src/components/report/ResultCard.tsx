"use client";

import CopyButton from "@/components/CopyButton";
import { useT } from "@/components/I18nProvider";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { languageLabel } from "@/lib/i18n";
import type { ReportResult } from "./useReportSubmission";

/**
 * Confirmation screen after a report is submitted. It shows the AI's full
 * triage back to the citizen for transparency, explains a duplicate merge in
 * plain words, and links straight to the tracking page. The live region
 * announces the result to screen-reader users.
 */
export default function ResultCard({ result, onReportAnother }: { result: ReportResult; onReportAnother: () => void }) {
  const t = useT();
  const { ticket } = result;
  return (
    <section aria-live="polite" className="mx-auto max-w-2xl rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm font-medium text-emerald-700">
        {result.merged ? t("result.merged") : t("result.submitted")}
      </p>
      <h2 className="mt-1 text-2xl font-semibold">
        {t("result.ticket")} <span className="font-mono">{ticket.id}</span>
      </h2>
      {result.unverified && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("result.unverified")}</p>
      )}
      {result.merged && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t("result.mergedCount", { count: ticket.reporterCount })} <span lang="en">{result.reason}</span>
        </p>
      )}
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-slate-600">{t("ticket.category")}</dt>
        <dd>{t(`category.${ticket.category}`)}</dd>
        <dt className="text-slate-600">{t("ticket.priority")}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={ticket.priority} />
          <span className="text-slate-600" lang="en">
            {ticket.priorityReason}
          </span>
        </dd>
        <dt className="text-slate-600">{t("ticket.department")}</dt>
        <dd lang="en">{ticket.department}</dd>
        <dt className="text-slate-600">{t("ticket.status")}</dt>
        <dd>
          <StatusBadge status={ticket.status} />
        </dd>
        <dt className="text-slate-600">{t("ticket.language")}</dt>
        <dd>{languageLabel(t, ticket.originalLanguage)}</dd>
        <dt className="text-slate-600">{t("ticket.summary")}</dt>
        <dd lang="en">{ticket.englishSummary}</dd>
        {ticket.transcript && (
          <>
            <dt className="text-slate-600">{t("ticket.transcript")}</dt>
            <dd lang={ticket.originalLanguage} className="italic">
              {ticket.transcript}
            </dd>
          </>
        )}
      </dl>
      {result.aiSource === "fallback" && !result.unverified && (
        <p className="mt-3 text-xs text-slate-600">{t("result.fallback")}</p>
      )}
      {/* The private link is shown once. It lets the citizen message the
          department and confirm the fix, with no account and no personal details. */}
      <div className="mt-5 rounded-lg bg-emerald-50 p-4 ring-1 ring-emerald-200">
        <p className="text-sm font-semibold text-emerald-900">{t("result.saveLink")}</p>
        <p className="mt-1 text-xs text-emerald-900">{t("result.saveLinkHelp")}</p>
        <div className="mt-2 flex gap-2">
          <label htmlFor="plink" className="sr-only">
            {t("result.linkLabel")}
          </label>
          <input
            id="plink"
            readOnly
            value={result.privateLink}
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 rounded-md border border-emerald-300 bg-white px-2 py-1.5 font-mono text-xs"
          />
          <CopyButton text={result.privateLink} />
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <a href={result.privateLink} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          {t("result.open")}
        </a>
        <button onClick={onReportAnother} className="rounded-md px-4 py-2 text-sm font-medium ring-1 ring-slate-300">
          {t("result.another")}
        </button>
      </div>
    </section>
  );
}
