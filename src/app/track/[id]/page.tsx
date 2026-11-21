import Link from "next/link";
import { notFound } from "next/navigation";
import Map from "@/components/Map";
import { PriorityBadge, StatusBadge, fmtDate, langName } from "@/components/badges";
import { store } from "@/lib/store";
import { STATUSES, fmtDay, isHeld } from "@/lib/types";
import { isReporter, toPrivate, toPublic } from "@/lib/workflow";
import CitizenPanel from "./CitizenPanel";

// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT][EFFICIENCY] SINGLE TICKET TRACKING PAGE: "from submission to tracking and resolution"
// -----------------------------------------------------------------------------
// BRIEF ✔ the core end-to-end story: a three-step progress bar
// (Reported → In Progress → Resolved) plus a dated timeline of every status
// change, department hand-off, note and duplicate report merged in.
// Accountability is shown publicly: the responsible department, its committed
// fix date, the SLA deadline (with an OVERDUE flag), and the proof of fix:
// the department's after photo next to the citizen's before photo, with
// Gemini's verdict.
// With the citizen's private link (?k=…) the page also shows their private
// panel: the conversation with the department and the confirm/reopen buttons.
// Server-rendered: it reads the database directly, so it loads fast even on
// slow phones and works as a shareable link.
// =============================================================================

export const dynamic = "force-dynamic"; // always show the latest status, never a cached copy

const VERDICT = {
  fixed: { text: "Gemini: the after photo shows the issue fixed", cls: "bg-emerald-50 text-emerald-900 ring-emerald-200" },
  not_fixed: { text: "Gemini: the after photo may NOT show the issue fixed", cls: "bg-red-50 text-red-900 ring-red-200" },
  unclear: { text: "Gemini: couldn't confirm from the photo", cls: "bg-slate-50 text-slate-800 ring-slate-200" },
};
const CONFIRMATION: Record<string, string> = {
  pending: "Waiting for the citizen to confirm the fix",
  confirmed: "Citizen confirmed the fix ✔",
  "auto-closed": "Closed automatically (no reply from the citizen)",
  reopened: "Reopened by the citizen",
};

export default async function TicketPage({ params, searchParams }: PageProps<"/track/[id]">) {
  const { id } = await params;
  const { k } = await searchParams;
  const raw = await store().get(id.toUpperCase());
  if (!raw) notFound();
  // [SECURITY] Only the sanitised view is ever passed to client components; the
  // raw ticket (with reporter secrets) stays on the server.
  const token = typeof k === "string" ? k : null;
  const owner = isReporter(raw, token);
  // [SECURITY] A report held for review (sent without phone verification) is visible only to
  // its own reporter, so unscreened content never appears on public pages.
  if (isHeld(raw) && !owner) notFound();
  const t = toPublic(raw);
  const reached = STATUSES.indexOf(t.status);

  return (
    <div className="space-y-6">
      <Link href="/track" className="text-sm text-blue-700 underline">← All issues</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-slate-600">{t.id}</p>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="text-sm text-slate-600">{t.location.address || "Pinned location"} · reported {fmtDate(t.createdAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PriorityBadge p={t.priority} />
          <StatusBadge s={t.status} />
          {t.overdue && <span className="rounded-full bg-red-700 px-2 py-0.5 text-xs font-semibold text-white">OVERDUE</span>}
        </div>
      </div>

      {raw.verification === "unverified" && (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Waiting for review: this report was sent without phone verification, so a city officer checks it
          before it goes to {t.department}. Only you can see this page.
        </p>
      )}
      {raw.verification === "rejected" && (
        <p role="status" className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-800">
          After review, this report was not accepted. See the timeline below for the reason.
        </p>
      )}

      {token && !owner && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This private link isn&apos;t valid for this ticket. You can still see its public progress below.
        </p>
      )}

      {/* Progress bar: Reported → In Progress → Resolved */}
      <ol aria-label="Progress" className="grid grid-cols-3 gap-2">
        {STATUSES.map((s, i) => (
          <li key={s} aria-current={i === reached ? "step" : undefined}
            className={`rounded-md px-3 py-2 text-center text-sm font-medium ${
              i <= reached ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"}`}>
            {s}
          </li>
        ))}
      </ol>

      {/* Accountability strip: who owns it, by when. */}
      <dl className="grid grid-cols-2 gap-3 rounded-lg bg-white p-4 text-sm ring-1 ring-slate-200 md:grid-cols-4">
        <div><dt className="text-slate-600">Responsible</dt><dd className="font-medium">{t.department}</dd></div>
        <div><dt className="text-slate-600">Accepted</dt><dd className="font-medium">{t.acknowledgedAt ? fmtDate(t.acknowledgedAt) : "Not yet"}</dd></div>
        <div><dt className="text-slate-600">Promised fix date</dt><dd className="font-medium">{t.expectedFixDate ? fmtDay(t.expectedFixDate) : "Not set"}</dd></div>
        <div>
          <dt className="text-slate-600">Target (by priority)</dt>
          <dd className={`font-medium ${t.overdue ? "text-red-700" : ""}`}>{fmtDate(t.slaDueAt)}{t.overdue ? " · overdue" : ""}</dd>
        </div>
      </dl>

      {owner && <CitizenPanel ticket={toPrivate(raw)} token={token!} />}

      {t.resolution && (
        <section aria-labelledby="proof-h" className="space-y-3 rounded-lg bg-white p-5 ring-1 ring-slate-200">
          <h2 id="proof-h" className="font-semibold">Proof of fix</h2>
          <p className="text-sm">{t.resolution.note} <span className="text-slate-600">({t.resolution.by}, {fmtDate(t.resolution.at)})</span></p>
          <p className={`rounded-md px-3 py-2 text-sm ring-1 ${VERDICT[t.resolution.aiVerdict].cls}`}>
            {VERDICT[t.resolution.aiVerdict].text}. {t.resolution.aiReason}
          </p>
          {t.citizenConfirmation && <p className="text-sm font-medium">{CONFIRMATION[t.citizenConfirmation]}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {t.hasImage && (
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/tickets/${t.id}/image`} alt={`Before: ${t.title}`} className="max-h-60 rounded-md ring-1 ring-slate-200" />
                <figcaption className="text-xs text-slate-600">Before (citizen)</figcaption>
              </figure>
            )}
            {t.resolution.hasPhoto && (
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/tickets/${t.id}/image?v=after&t=${encodeURIComponent(t.resolution.at)}`} alt={`After the fix: ${t.title}`} className="max-h-60 rounded-md ring-1 ring-slate-200" />
                <figcaption className="text-xs text-slate-600">After ({t.resolution.by})</figcaption>
              </figure>
            )}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-lg bg-white p-5 ring-1 ring-slate-200">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-600">Category</dt><dd>{t.category}</dd>
            <dt className="text-slate-600">Why this priority</dt><dd>{t.priorityReason}</dd>
            <dt className="text-slate-600">Reporters</dt><dd>{t.reporterCount}</dd>
            {(t.transfers ?? 0) > 0 && (<><dt className="text-slate-600">Hand-offs</dt><dd>{t.transfers}</dd></>)}
            {(t.reopenCount ?? 0) > 0 && (<><dt className="text-slate-600">Reopened</dt><dd>{t.reopenCount}×</dd></>)}
            <dt className="text-slate-600">Language</dt><dd>{langName(t.originalLanguage)}</dd>
            <dt className="text-slate-600">English summary</dt><dd>{t.englishSummary}</dd>
            {/* [ACCESSIBILITY] lang attribute lets screen readers pronounce Tamil/Hindi text correctly. */}
            <dt className="text-slate-600">Original report</dt><dd lang={t.originalLanguage}>{t.description}</dd>
            {t.transcript && (<><dt className="text-slate-600">Voice transcript</dt><dd lang={t.originalLanguage} className="italic">{t.transcript}</dd></>)}
          </dl>
          {t.hasImage && !t.resolution && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/tickets/${t.id}/image`} alt={`Photo of: ${t.title}`} className="max-h-72 rounded-md ring-1 ring-slate-200" />
          )}
        </section>
        <section className="space-y-4">
          <Map tickets={[t]} center={t.location} zoom={16} height={260} />
          <div className="rounded-lg bg-white p-5 ring-1 ring-slate-200">
            <h2 className="mb-3 font-semibold">Timeline</h2>
            <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
              {(t.history ?? []).map((h, i) => (
                <li key={i} className="relative">
                  <span aria-hidden className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-emerald-600 ring-4 ring-white" />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusBadge s={h.status} />
                    <time className="text-slate-600" dateTime={h.at}>{fmtDate(h.at)}</time>
                  </div>
                  {h.note && <p className="mt-1 text-sm text-slate-700">{h.note}</p>}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}
