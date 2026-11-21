import Link from "next/link";
import { notFound } from "next/navigation";
import Map from "@/components/Map";
import { getTranslator } from "@/lib/i18n/server";
import { store } from "@/lib/store";
import { isHeld } from "@/lib/types";
import { isReporter, photoUrl, toPrivate, toPublic } from "@/lib/workflow";
import AccountabilityStrip from "./AccountabilityStrip";
import CitizenPanel from "./CitizenPanel";
import FactsTable from "./FactsTable";
import ProofOfFix from "./ProofOfFix";
import StatusSteps from "./StatusSteps";
import TicketHeader from "./TicketHeader";
import TicketNotices from "./TicketNotices";
import Timeline from "./Timeline";

export const dynamic = "force-dynamic"; // always show the latest status, never a cached copy

/**
 * Single ticket tracking page, from submission to resolution: a three-step
 * progress bar (Reported, In Progress, Resolved) plus a dated timeline of
 * every status change, department hand-off, note and merged duplicate report.
 *
 * Accountability is shown publicly: the responsible department, its committed
 * fix date, the target date (flagged when overdue), and the proof of fix: the
 * department's after photo next to the citizen's before photo, with Gemini's
 * verdict. With the citizen's private link (?k=...) the page also shows their
 * private panel: the conversation with the department and the confirm/reopen
 * buttons.
 *
 * Server-rendered: it reads the database directly, so it loads fast even on
 * slow phones and works as a shareable link. Fixed labels are translated on
 * the server from the language cookie; what people and Gemini wrote (titles,
 * summaries, notes, department names) is shown as stored and marked with its
 * own language for screen readers.
 */
export default async function TicketPage({ params, searchParams }: PageProps<"/track/[id]">) {
  const t = await getTranslator();
  const { id } = await params;
  const { k: privateKey } = await searchParams;
  const storedTicket = await store().get(id.toUpperCase());
  if (!storedTicket) notFound();
  const token = typeof privateKey === "string" ? privateKey : null;
  const isOwner = isReporter(storedTicket, token);
  // A report held for review (sent without phone verification) is visible only to
  // its own reporter, so unscreened content never appears on public pages.
  if (isHeld(storedTicket) && !isOwner) notFound();
  // Only the sanitised view is rendered and passed to client components; the
  // stored ticket (with reporter secrets) stays on the server.
  const ticket = toPublic(storedTicket);
  const { resolution } = ticket;

  return (
    <div className="space-y-6">
      <Link href="/track" className="text-sm text-blue-700 underline">
        <span aria-hidden>← </span>
        {t("ticket.back")}
      </Link>
      <TicketHeader ticket={ticket} t={t} />

      <TicketNotices
        verification={storedTicket.verification}
        department={ticket.department}
        badLink={Boolean(token) && !isOwner}
        t={t}
      />

      <StatusSteps status={ticket.status} t={t} />

      <AccountabilityStrip ticket={ticket} t={t} />

      {isOwner && <CitizenPanel ticket={toPrivate(storedTicket)} token={token!} />}

      {resolution && <ProofOfFix ticket={ticket} resolution={resolution} t={t} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-lg bg-white p-5 ring-1 ring-slate-200">
          <FactsTable ticket={ticket} t={t} />
          {ticket.hasImage && !resolution && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl(ticket, "before")}
              alt={t("ticket.photoAlt", { title: ticket.title })}
              className="max-h-72 rounded-md ring-1 ring-slate-200"
            />
          )}
        </section>
        <section className="space-y-4">
          <Map tickets={[ticket]} center={ticket.location} zoom={16} height={260} />
          <Timeline history={ticket.history} t={t} />
        </section>
      </div>
    </div>
  );
}
