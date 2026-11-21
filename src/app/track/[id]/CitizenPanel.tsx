"use client";

// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT] CITIZEN'S PRIVATE PANEL (shown only with a valid link token)
// -----------------------------------------------------------------------------
//   • Chat with the department, in the citizen's own language (Gemini translates).
//   • When the department reports a fix: "Yes, it's fixed" closes the ticket;
//     "Not fixed: reopen" sends it back with a note and an optional new photo.
// The token travels in the x-citizen-key header, never in a request body
// that might get logged.
// =============================================================================

import { useRouter } from "next/navigation";
import { useState } from "react";
import MessageThread from "@/components/MessageThread";
import { downscale } from "@/lib/client/image";
import type { PrivateTicket } from "@/lib/types";

export default function CitizenPanel({ ticket, token }: { ticket: PrivateTicket; token: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState(ticket.messages);
  const [reopening, setReopening] = useState(false);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const awaiting = ticket.status === "Resolved" && ticket.citizenConfirmation !== "confirmed";

  async function send(text: string) {
    const r = await fetch(`/api/tickets/${ticket.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-citizen-key": token },
      body: JSON.stringify({ text }),
    });
    const data = await r.json();
    if (!r.ok) return data.error ?? "Couldn't send.";
    setMessages(data.messages);
    return null;
  }

  async function decide(decision: "confirm" | "reopen") {
    setError(null);
    const fd = new FormData();
    fd.set("decision", decision);
    fd.set("note", note);
    if (photo) fd.set("photo", photo, "photo.jpg");
    setBusy(true);
    const r = await fetch(`/api/tickets/${ticket.id}/confirm`, { method: "POST", headers: { "x-citizen-key": token }, body: fd });
    setBusy(false);
    if (!r.ok) return setError((await r.json()).error ?? "Something went wrong.");
    router.refresh(); // re-render the server page with the new status and timeline
  }

  return (
    <section aria-labelledby="private-h" className="space-y-4 rounded-lg bg-white p-5 ring-2 ring-emerald-300">
      <div>
        <h2 id="private-h" className="font-semibold">Your private view</h2>
        <p className="text-sm text-slate-600">
          Only you can see this. The department doesn&apos;t know who you are.
        </p>
      </div>

      {awaiting && (
        <div className="rounded-md bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="font-medium text-amber-900">The department says this is fixed. Is it?</p>
          {!reopening ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => decide("confirm")} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                Yes, it&apos;s fixed
              </button>
              <button onClick={() => setReopening(true)} className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-300">
                Not fixed: reopen
              </button>
            </div>
          ) : (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                decide("reopen");
              }}
            >
              <label htmlFor="reopen-note" className="block text-sm font-medium">What is still wrong?</label>
              <textarea id="reopen-note" required value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <label htmlFor="reopen-photo" className="block text-sm font-medium">New photo (optional)</label>
              <input id="reopen-photo" type="file" accept="image/*" capture="environment"
                onChange={async (e) => { const f = e.target.files?.[0]; setPhoto(f ? await downscale(f) : null); }}
                className="block text-sm" />
              <div className="flex gap-2">
                <button disabled={busy} className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {busy ? "Sending…" : "Reopen issue"}
                </button>
                <button type="button" onClick={() => setReopening(false)} className="text-sm underline">Cancel</button>
              </div>
            </form>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
      {ticket.citizenConfirmation === "confirmed" && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">You confirmed this is fixed. Thank you!</p>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Messages with {ticket.department}</h3>
        <MessageThread messages={messages} viewer="citizen" onSend={send} />
      </div>
    </section>
  );
}
