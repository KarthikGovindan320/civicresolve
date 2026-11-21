import { formatDateTime } from "@/lib/client/format";
import type { Translate } from "@/lib/i18n";
import type { PublicTicket, Resolution } from "@/lib/types";
import { photoUrl } from "@/lib/workflow";

const AI_VERDICT_CLASS = {
  fixed: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  not_fixed: "bg-red-50 text-red-900 ring-red-200",
  unclear: "bg-slate-50 text-slate-800 ring-slate-200",
};

/**
 * Proof of fix: the department's note and after photo next to the citizen's
 * before photo, with Gemini's verdict and the citizen's confirmation.
 */
export default function ProofOfFix({
  ticket,
  resolution,
  t,
}: {
  ticket: PublicTicket;
  resolution: Resolution;
  t: Translate;
}) {
  return (
    <section aria-labelledby="proof-h" className="space-y-3 rounded-lg bg-white p-5 ring-1 ring-slate-200">
      <h2 id="proof-h" className="font-semibold">
        {t("ticket.proof")}
      </h2>
      <p className="text-sm">
        {resolution.note}{" "}
        <span className="text-slate-600">
          ({resolution.by}, {formatDateTime(resolution.at)})
        </span>
      </p>
      <p className={`rounded-md px-3 py-2 text-sm ring-1 ${AI_VERDICT_CLASS[resolution.aiVerdict]}`}>
        {t(`ticket.verdict.${resolution.aiVerdict}`)}. <span lang="en">{resolution.aiReason}</span>
      </p>
      {ticket.citizenConfirmation && (
        <p className="text-sm font-medium">{t(`ticket.confirmation.${ticket.citizenConfirmation}`)}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {ticket.hasImage && (
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl(ticket, "before")}
              alt={t("ticket.beforeAlt", { title: ticket.title })}
              className="max-h-60 rounded-md ring-1 ring-slate-200"
            />
            <figcaption className="text-xs text-slate-600">{t("ticket.beforeCaption")}</figcaption>
          </figure>
        )}
        {resolution.hasPhoto && (
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl(ticket, "after", resolution.at)}
              alt={t("ticket.afterAlt", { title: ticket.title })}
              className="max-h-60 rounded-md ring-1 ring-slate-200"
            />
            <figcaption className="text-xs text-slate-600">
              {t("ticket.afterCaption", { by: resolution.by })}
            </figcaption>
          </figure>
        )}
      </div>
    </section>
  );
}
