import Link from "next/link";
import { getTranslator } from "@/lib/i18n/server";

/**
 * Friendly "not found" message in the visitor's language, with a way back to
 * tracking and reporting instead of a dead end. Used for unknown pages and for
 * ticket ids that do not exist or are not public (a report still held for
 * review is visible only through its reporter's private link).
 */
export default async function NotFoundNotice({ kind }: { kind: "page" | "ticket" }) {
  const t = await getTranslator();
  const isTicket = kind === "ticket";
  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <p className="font-mono text-sm text-slate-600">404</p>
      <h1 className="mt-1 text-xl font-semibold">{t(isTicket ? "notFound.ticketTitle" : "notFound.title")}</h1>
      <p className="mt-2 text-sm text-slate-600">{t(isTicket ? "notFound.ticketBody" : "notFound.body")}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href="/track" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          {t("notFound.toTrack")}
        </Link>
        <Link href="/" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium">
          {t("notFound.toReport")}
        </Link>
      </div>
    </div>
  );
}
