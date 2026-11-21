import { languageLabel, type Translate } from "@/lib/i18n";
import type { PublicTicket } from "@/lib/types";

/**
 * The ticket's facts as a definition list: category, why it got its priority,
 * how many people reported it, hand-offs and reopens (only when there are
 * any), and the report itself in English and in the citizen's own words.
 */
export default function FactsTable({ ticket, t }: { ticket: PublicTicket; t: Translate }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      <dt className="text-slate-600">{t("ticket.category")}</dt>
      <dd>{t(`category.${ticket.category}`)}</dd>
      <dt className="text-slate-600">{t("ticket.whyPriority")}</dt>
      <dd lang="en">{ticket.priorityReason}</dd>
      <dt className="text-slate-600">{t("ticket.reporters")}</dt>
      <dd>{ticket.reporterCount}</dd>
      {(ticket.transfers ?? 0) > 0 && (
        <>
          <dt className="text-slate-600">{t("ticket.handoffs")}</dt>
          <dd>{ticket.transfers}</dd>
        </>
      )}
      {(ticket.reopenCount ?? 0) > 0 && (
        <>
          <dt className="text-slate-600">{t("ticket.reopened")}</dt>
          <dd>{ticket.reopenCount}×</dd>
        </>
      )}
      <dt className="text-slate-600">{t("ticket.language")}</dt>
      <dd>{languageLabel(t, ticket.originalLanguage)}</dd>
      <dt className="text-slate-600">{t("ticket.englishSummary")}</dt>
      <dd lang="en">{ticket.englishSummary}</dd>
      {/* The lang attribute lets screen readers pronounce Tamil or Hindi text correctly. */}
      <dt className="text-slate-600">{t("ticket.original")}</dt>
      <dd lang={ticket.originalLanguage}>{ticket.description}</dd>
      {ticket.transcript && (
        <>
          <dt className="text-slate-600">{t("ticket.voiceTranscript")}</dt>
          <dd lang={ticket.originalLanguage} className="italic">
            {ticket.transcript}
          </dd>
        </>
      )}
    </dl>
  );
}
