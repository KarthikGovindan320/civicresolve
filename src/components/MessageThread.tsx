"use client";

import { useId, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { languageLabel } from "@/lib/i18n";
import { LIMITS, type Message } from "@/lib/types";
import { useT } from "./I18nProvider";

/** The language staff write and read in; citizen messages are translated into it. */
const STAFF_LANGUAGE = "en";

/**
 * Conversation between a department and the citizen, used on both sides (the
 * citizen's private page and the staff dashboard). Each message shows the
 * original text and Gemini's translation, so both parties read it in their
 * own language. The list sits in an ARIA log, so screen readers announce new
 * messages politely.
 */
export default function MessageThread({
  messages,
  viewer,
  citizenLanguage,
  onSend,
}: {
  messages: Message[];
  viewer: "citizen" | "staff";
  /** The citizen's language (the ticket's original language): staff messages are translated into it. */
  citizenLanguage: string;
  /** Sends the message; resolves to an error message, or null on success. */
  onSend: (text: string) => Promise<string | null>;
}) {
  const t = useT();
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwnMessage = (message: Message) =>
    viewer === "citizen" ? message.from === "citizen" : message.from === "department" || message.from === "admin";
  const translationLanguage = (message: Message) => (message.from === "citizen" ? STAFF_LANGUAGE : citizenLanguage);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    setError(null);
    const sendError = await onSend(draft.trim());
    setSending(false);
    if (sendError) setError(sendError);
    else setDraft("");
  }

  const bubbleClass = (message: Message) => {
    if (message.from === "system") return "bg-slate-100 text-slate-700";
    return isOwnMessage(message) ? "ml-8 bg-emerald-50 ring-1 ring-emerald-200" : "mr-8 bg-white ring-1 ring-slate-200";
  };

  return (
    <div>
      {/* Focusable so keyboard users can scroll a long conversation. */}
      <div role="log" aria-label={t("chat.label")} tabIndex={0} className="max-h-80 overflow-y-auto">
        <ol className="space-y-2">
          {messages.map((message) => (
            <li key={message.id} className={`rounded-lg px-3 py-2 text-sm ${bubbleClass(message)}`}>
              <div className="mb-0.5 flex flex-wrap gap-x-2 text-xs text-slate-600">
                <span className="font-medium">{t(`chat.sender.${message.from}`)}</span>
                <time dateTime={message.at}>{formatDateTime(message.at)}</time>
              </div>
              <p lang={message.lang}>{message.text}</p>
              {message.translation && (
                <p className="mt-1 border-t border-slate-200 pt-1 text-slate-700">
                  <span className="text-xs text-slate-600">
                    {t("chat.translated", { language: languageLabel(t, message.lang) })}{" "}
                  </span>
                  <span lang={translationLanguage(message)}>{message.translation}</span>
                </p>
              )}
            </li>
          ))}
          {!messages.length && <li className="text-sm text-slate-600">{t("chat.empty")}</li>}
        </ol>
      </div>
      <form onSubmit={send} className="mt-3 flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          {t("chat.write")}
        </label>
        <input
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={LIMITS.message}
          placeholder={viewer === "citizen" ? t("chat.placeholder") : "Message the citizen (auto-translated)…"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <button
          disabled={sending}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {sending ? t("common.sending") : t("chat.send")}
        </button>
      </form>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
