"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import Interpolate from "@/components/Interpolate";
import MessageThread from "@/components/MessageThread";
import { citizenRequest, failureMessages, settle } from "@/lib/client/api";
import { downscaleSelected } from "@/lib/client/image";
import { LIMITS, type PrivateTicket } from "@/lib/types";

/**
 * The citizen's private panel, shown only with a valid private-link token:
 *   - Chat with the department in the citizen's own language (Gemini translates).
 *   - When the department reports a fix, "Yes, it's fixed" closes the ticket;
 *     "Not fixed: reopen" sends it back with a note and an optional new photo.
 * The token travels in a request header, never in a body that might get logged.
 */
export default function CitizenPanel({ ticket, token }: { ticket: PrivateTicket; token: string }) {
  const t = useT();
  const router = useRouter();
  const [messages, setMessages] = useState(ticket.messages);
  const [reopening, setReopening] = useState(false);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Announced once a decision is saved: the question it answered disappears when the page refreshes.
  const [notice, setNotice] = useState("");
  const awaitingConfirmation = ticket.status === "Resolved" && ticket.citizenConfirmation !== "confirmed";
  const ticketPath = `/api/tickets/${ticket.id}`;

  /** Sends a message to the department. Returns an error message, or null on success. */
  async function sendMessage(text: string): Promise<string | null> {
    const outcome = await settle(
      citizenRequest<PrivateTicket>(`${ticketPath}/messages`, token, { method: "POST", json: { text } }),
      failureMessages(t, "chat.error.send"),
    );
    if (!outcome.ok) return outcome.error;
    setMessages(outcome.data.messages);
    return null;
  }

  async function decide(decision: "confirm" | "reopen") {
    setError(null);
    const form = new FormData();
    form.set("decision", decision);
    form.set("note", note);
    if (photo) form.set("photo", photo, "photo.jpg");
    setBusy(true);
    const outcome = await settle(
      citizenRequest<PrivateTicket>(`${ticketPath}/confirm`, token, { method: "POST", form }),
      failureMessages(t),
    );
    setBusy(false);
    if (!outcome.ok) return setError(outcome.error);
    setNotice(t(decision === "confirm" ? "panel.confirmed" : "panel.reopened"));
    router.refresh(); // re-render the server page with the new status and timeline
  }

  return (
    <section aria-labelledby="private-h" className="space-y-4 rounded-lg bg-white p-5 ring-2 ring-emerald-300">
      <div>
        <h2 id="private-h" className="font-semibold">
          {t("panel.heading")}
        </h2>
        <p className="text-sm text-slate-600">{t("panel.intro")}</p>
      </div>
      <p role="status" className="sr-only">
        {notice}
      </p>

      {awaitingConfirmation && (
        <div className="rounded-md bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="font-medium text-amber-900">{t("panel.question")}</p>
          {!reopening ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                disabled={busy}
                onClick={() => decide("confirm")}
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                {t("panel.yes")}
              </button>
              <button
                onClick={() => setReopening(true)}
                className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-300"
              >
                {t("panel.no")}
              </button>
            </div>
          ) : (
            <form
              className="mt-3 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                decide("reopen");
              }}
            >
              <label htmlFor="reopen-note" className="block text-sm font-medium">
                {t("panel.whatWrong")}
              </label>
              <textarea
                id="reopen-note"
                required
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={LIMITS.citizenNote}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <label htmlFor="reopen-photo" className="block text-sm font-medium">
                {t("panel.newPhoto")}
              </label>
              <input
                id="reopen-photo"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={async (event) => setPhoto(await downscaleSelected(event.target))}
                className="block text-sm"
              />
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busy ? t("common.sending") : t("panel.reopen")}
                </button>
                <button
                  type="button"
                  onClick={() => setReopening(false)}
                  className="inline-flex min-h-6 items-center text-sm underline"
                >
                  {t("panel.cancel")}
                </button>
              </div>
            </form>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
      {ticket.citizenConfirmation === "confirmed" && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t("panel.confirmed")}</p>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">
          <Interpolate
            message={t("panel.messagesWith")}
            values={{ department: <span lang="en">{ticket.department}</span> }}
          />
        </h3>
        <MessageThread
          messages={messages}
          viewer="citizen"
          citizenLanguage={ticket.originalLanguage}
          onSend={sendMessage}
        />
      </div>
    </section>
  );
}
