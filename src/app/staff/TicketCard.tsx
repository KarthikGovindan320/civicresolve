"use client";

// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT] One ticket in a staff work queue
// -----------------------------------------------------------------------------
// The actions shown depend on where the ticket is in its lifecycle:
//   Reported     → Accept (with a promised fix date) · Transfer to another department
//   In Progress  → Mark fixed (after photo, verified by Gemini) · Transfer
//   Resolved     → read-only: proof, AI verdict, citizen confirmation
// Always: message the citizen (auto-translated) and add public notes.
// City admin only: override the AI's category / department / priority / status.
// Every button is a real <button>, every field has a label, and the card
// expands with a native <details> element, so it is keyboard and screen-reader
// friendly without custom widgets [ACCESSIBILITY].
// =============================================================================

import Link from "next/link";
import { useState } from "react";
import MessageThread from "@/components/MessageThread";
import { PriorityBadge, StatusBadge, fmtDate, langName } from "@/components/badges";
import { downscale } from "@/lib/client/image";
import { CATEGORIES, DEPARTMENTS, PRIORITIES, STATUSES, fmtDay, isHeld, isPendingReview } from "@/lib/types";
import type { StaffTicket } from "./page";

const sel = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const inp = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
const btn = "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60";

export default function TicketCard({
  t,
  staffKey,
  isAdmin,
  onUpdated,
}: {
  t: StaffTicket;
  staffKey: string;
  isAdmin: boolean;
  onUpdated: (t: StaffTicket, msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixBy, setFixBy] = useState("");
  const [ackNote, setAckNote] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [fixNote, setFixNote] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [note, setNote] = useState("");
  const headers = { "x-staff-key": staffKey };

  // One request helper for every action: shows errors inline, and on success
  // hands the server's updated ticket back to the dashboard.
  async function run(req: () => Promise<Response>, okMsg: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await req();
      const data = await r.json();
      if (!r.ok) setError(data.error ?? "Something went wrong.");
      else onUpdated(data, `${t.id}: ${okMsg}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const patch = (body: object, okMsg: string) =>
    run(() => fetch(`/api/tickets/${t.id}`, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }), okMsg);

  async function sendMessage(text: string) {
    const r = await fetch(`/api/tickets/${t.id}/messages`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await r.json();
    if (!r.ok) return data.error ?? "Couldn't send.";
    onUpdated(data, `${t.id}: message sent`);
    return null;
  }

  function resolve(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("note", fixNote);
    if (photo) fd.set("photo", photo, "after.jpg");
    run(() => fetch(`/api/tickets/${t.id}/resolve`, { method: "POST", headers, body: fd }), "marked fixed, awaiting citizen");
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <li className={`rounded-lg bg-white ring-1 ${t.overdue ? "ring-red-300" : "ring-slate-200"}`}>
      <details>
        <summary className="cursor-pointer list-none p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs text-slate-600">{t.id}</span>
            <span className="min-w-[12rem] flex-1 font-medium">{t.title}</span>
            {t.overdue && <span className="rounded-full bg-red-700 px-2 py-0.5 text-xs font-semibold text-white">Overdue</span>}
            {(t.reopenCount ?? 0) > 0 && t.status !== "Resolved" && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-900">Reopened ×{t.reopenCount}</span>
            )}
            {t.resolution?.aiVerdict === "not_fixed" && t.status === "Resolved" && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-900">AI doubts fix</span>
            )}
            {t.reporterCount > 1 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{t.reporterCount} reporters</span>
            )}
            {t.messageCount > 0 && <span className="text-xs text-slate-600">💬 {t.messageCount}</span>}
            <PriorityBadge p={t.priority} />
            <StatusBadge s={t.status} />
          </div>
          <p className="mt-1 text-sm text-slate-700">{t.englishSummary}</p>
          <p className="mt-0.5 text-xs text-slate-600">
            {isAdmin && <>{t.department} · </>}
            Target {fmtDate(t.slaDueAt)}
            {t.expectedFixDate && <> · promised by {fmtDay(t.expectedFixDate)}</>} · {langName(t.originalLanguage)} · {t.location.address || "Pinned"}
            {t.classifiedBy === "fallback" && " · ⚠ rule-classified, please verify"}
          </p>
        </summary>

        <div className="space-y-4 border-t border-slate-200 p-4">
          <p className="text-sm text-slate-700"><span className="text-slate-600">Why this priority: </span>{t.priorityReason}</p>
          {/* Held reports have no public page (it would 404), so the link only shows once a report is live. */}
          {!isHeld(t) && <Link href={`/track/${t.id}`} className="text-sm text-blue-700 underline">Public page, map and photos →</Link>}
          {/* The citizen's new evidence when they reopened the issue. Without this the department never sees it. */}
          {t.hasReopenPhoto && t.citizenConfirmation === "reopened" && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/tickets/${t.id}/image?v=reopen&t=${encodeURIComponent(t.updatedAt)}`} alt={`New photo from the citizen after reopening ${t.id}`} className="max-h-48 rounded-md ring-1 ring-slate-200" />
              <figcaption className="text-xs text-slate-600">Citizen&apos;s new photo (issue reopened)</figcaption>
            </figure>
          )}

          {/* ---- Review of reports sent without phone verification (admin only) ---- */}
          {isAdmin && isPendingReview(t) && (
            <div className="space-y-2 rounded-md bg-amber-50 p-3 ring-1 ring-amber-200">
              <p className="text-sm text-amber-900">
                Sent <strong>without phone verification</strong>, so it was classified by rules, not Gemini.
                Check it, correct the category below if needed, then approve it into {t.department}&apos;s queue or reject it.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex-1 text-sm">Note (optional, shown to the citizen){" "}
                  <input className={inp} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                </label>
                <button type="button" disabled={busy} onClick={() => patch({ action: "review", decision: "approve", note }, "approved")}
                  className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Approve</button>
                <button type="button" disabled={busy} onClick={() => patch({ action: "review", decision: "reject", note }, "rejected")}
                  className="rounded-md px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-red-300 disabled:opacity-50">Reject</button>
              </div>
            </div>
          )}

          {/* ---- Lifecycle actions ---- */}
          {t.status === "Reported" && !isPendingReview(t) && (
            <form
              onSubmit={(e) => { e.preventDefault(); patch({ action: "acknowledge", expectedFixDate: fixBy || undefined, note: ackNote }, "accepted"); }}
              className="flex flex-wrap items-end gap-2 rounded-md bg-emerald-50 p-3"
            >
              <label className="text-sm">Promise a fix by{" "}
                <input type="date" min={today} value={fixBy} onChange={(e) => setFixBy(e.target.value)} className={inp} />
              </label>
              <label className="flex-1 text-sm">Note to citizen (optional){" "}
                <input value={ackNote} onChange={(e) => setAckNote(e.target.value)} maxLength={500} className={`${inp} w-full`} />
              </label>
              <button disabled={busy} className={`${btn} bg-emerald-700 text-white`}>Accept issue</button>
            </form>
          )}

          {t.status === "In Progress" && (
            <form onSubmit={resolve} className="flex flex-wrap items-end gap-2 rounded-md bg-emerald-50 p-3">
              <label className="text-sm">After photo{isAdmin ? " (optional for admin)" : " (required)"}{" "}
                <input type="file" accept="image/*" capture="environment" required={!isAdmin}
                  onChange={async (e) => { const f = e.target.files?.[0]; setPhoto(f ? await downscale(f) : null); }}
                  className="block text-sm" />
              </label>
              <label className="flex-1 text-sm">What was done?{" "}
                <input required value={fixNote} onChange={(e) => setFixNote(e.target.value)} maxLength={500} className={`${inp} w-full`} />
              </label>
              <button disabled={busy} className={`${btn} bg-emerald-700 text-white`}>{busy ? "Checking photo with Gemini…" : "Mark fixed"}</button>
            </form>
          )}

          {t.status === "Resolved" && t.resolution && (
            <div className="rounded-md bg-slate-50 p-3 text-sm">
              <p><strong>Fix reported:</strong> {t.resolution.note} ({t.resolution.by}, {fmtDate(t.resolution.at)})</p>
              <p><strong>Gemini check:</strong> {t.resolution.aiVerdict.replace("_", " ")}. {t.resolution.aiReason}</p>
              <p><strong>Citizen:</strong> {t.citizenConfirmation ?? "n/a"}</p>
            </div>
          )}

          {t.status !== "Resolved" && (
            <form
              onSubmit={(e) => { e.preventDefault(); patch({ action: "transfer", department: to, note: reason }, `transferred to ${to}`); }}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="text-sm">Not ours? Transfer to{" "}
                <select required value={to} onChange={(e) => setTo(e.target.value)} className={sel}>
                  <option value="">Choose…</option>
                  {DEPARTMENTS.filter((d) => d !== t.department).map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
              <label className="flex-1 text-sm">Reason{" "}
                <input required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={`${inp} w-full`} />
              </label>
              <button disabled={busy} className={`${btn} ring-1 ring-slate-300`}>Transfer</button>
            </form>
          )}

          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

          {/* ---- Conversation with the citizen ---- */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">Conversation with the citizen (anonymous, auto-translated)</h3>
            <MessageThread messages={t.messages ?? []} viewer="staff" onSend={sendMessage} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) { patch({ action: "note", note }, "note added"); setNote(""); } }} className="flex gap-2">
            <label htmlFor={`note-${t.id}`} className="sr-only">Public timeline note for {t.id}</label>
            <input id={`note-${t.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to the public timeline"
              className={`${inp} min-w-40 flex-1`} maxLength={500} />
            <button className={`${btn} bg-slate-900 text-white`}>Add note</button>
          </form>

          {/* ---- City admin: human-in-the-loop overrides of the AI ---- */}
          {isAdmin && (
            <fieldset className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-xs font-medium text-slate-600">Admin overrides</legend>
              <label className="text-xs">Status{" "}
                <select className={sel} value={t.status} onChange={(e) => patch({ action: "update", status: e.target.value }, "status updated")}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-xs">Category{" "}
                <select className={sel} value={t.category} onChange={(e) => patch({ action: "update", category: e.target.value }, "re-categorised")}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="text-xs">Department{" "}
                <select className={sel} value={t.department} onChange={(e) => patch({ action: "update", department: e.target.value }, "re-assigned")}>
                  {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
              <label className="text-xs">Priority{" "}
                <select className={sel} value={t.basePriority ?? t.priority} onChange={(e) => patch({ action: "update", priority: e.target.value }, "priority set")}>
                  {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                </select>
              </label>
              {/* The select shows the admin's BASE priority; the effective one can be higher (life-safety rule or
                  several reporters). Said out loud so the two numbers never look like a bug. */}
              {t.priority !== (t.basePriority ?? t.priority) && (
                <p role="note" className="basis-full text-xs text-amber-800">
                  Effective priority is {t.priority}: raised automatically by the life-safety rule or by the number of reporters.
                </p>
              )}
            </fieldset>
          )}
        </div>
      </details>
    </li>
  );
}
