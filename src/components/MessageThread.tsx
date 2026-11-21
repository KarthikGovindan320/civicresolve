"use client";

// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT][ACCESSIBILITY] Conversation between a department
// and the citizen, used on both sides (citizen's private page, staff dashboard).
// Each message shows the original text and Gemini's translation, so both
// parties read it in their own language. The list is an ARIA log, so screen
// readers announce new messages politely.
// =============================================================================

import { useState } from "react";
import type { Message } from "@/lib/types";
import { fmtDate, langName } from "./badges";

const WHO: Record<Message["from"], string> = {
  citizen: "Citizen",
  department: "Department",
  admin: "City admin",
  system: "Update",
};

export default function MessageThread({
  messages,
  viewer,
  onSend,
}: {
  messages: Message[];
  viewer: "citizen" | "staff";
  onSend: (text: string) => Promise<string | null>; // returns an error message, or null on success
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = (m: Message) => (viewer === "citizen" ? m.from === "citizen" : m.from === "department" || m.from === "admin");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    const err = await onSend(text.trim());
    setBusy(false);
    if (err) setError(err);
    else setText("");
  }

  return (
    <div>
      <ol role="log" aria-label="Messages" aria-live="polite" className="max-h-80 space-y-2 overflow-y-auto">
        {messages.map((m) => (
          <li
            key={m.id}
            className={`rounded-lg px-3 py-2 text-sm ${
              m.from === "system" ? "bg-slate-100 text-slate-700" : mine(m) ? "ml-8 bg-emerald-50 ring-1 ring-emerald-200" : "mr-8 bg-white ring-1 ring-slate-200"
            }`}
          >
            <div className="mb-0.5 flex flex-wrap gap-x-2 text-xs text-slate-600">
              <span className="font-medium">{WHO[m.from]}</span>
              <time dateTime={m.at}>{fmtDate(m.at)}</time>
            </div>
            <p lang={m.lang}>{m.text}</p>
            {m.translation && (
              <p className="mt-1 border-t border-slate-200 pt-1 text-slate-700">
                <span className="text-xs text-slate-500">Translated from {langName(m.lang)} by Gemini: </span>
                {m.translation}
              </p>
            )}
          </li>
        ))}
        {!messages.length && <li className="text-sm text-slate-600">No messages yet.</li>}
      </ol>
      <form onSubmit={send} className="mt-3 flex gap-2">
        <label htmlFor={`msg-${viewer}`} className="sr-only">Write a message</label>
        <input
          id={`msg-${viewer}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          placeholder={viewer === "citizen" ? "Reply in any language…" : "Message the citizen (auto-translated)…"}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <button disabled={busy} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
          {busy ? "Sending…" : "Send"}
        </button>
      </form>
      {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
