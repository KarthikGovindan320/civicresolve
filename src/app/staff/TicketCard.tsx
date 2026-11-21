"use client";

import Link from "next/link";
import { useState } from "react";
import MessageThread from "@/components/MessageThread";
import { isHeld, isPendingReview } from "@/lib/types";
import AdminOverrides from "./actions/AdminOverrides";
import NoteForm from "./actions/NoteForm";
import ReviewPanel from "./actions/ReviewPanel";
import LifecycleActions from "./LifecycleActions";
import ReopenPhoto from "./ReopenPhoto";
import TicketSummary from "./TicketSummary";
import type { StaffTicket } from "./types";
import { type TicketUpdatedHandler, useTicketActions } from "./useTicketActions";

/**
 * One ticket in a staff work queue. The actions shown depend on where the
 * ticket is in its lifecycle:
 *   Reported     -> accept (with a promised fix date), or transfer to another department
 *   In Progress  -> mark fixed (after photo, verified by Gemini), or transfer
 *   Resolved     -> read-only: proof, AI verdict, citizen confirmation
 * Staff can always message the citizen (auto-translated) and add public
 * notes; the city admin can also override the AI's triage.
 *
 * Every control is a native button or labelled field, and the card expands
 * with a native <details> element, so it works with a keyboard and a screen
 * reader without custom widgets.
 */
export default function TicketCard({
  ticket,
  staffKey,
  isAdmin,
  onUpdated,
}: {
  ticket: StaffTicket;
  staffKey: string;
  isAdmin: boolean;
  onUpdated: TicketUpdatedHandler;
}) {
  const { busy, error, update, resolve, sendMessage } = useTicketActions(ticket, staffKey, onUpdated);
  // One note draft feeds both the review decision and the public timeline note.
  const [note, setNote] = useState("");
  const pendingReview = isPendingReview(ticket);

  return (
    <li className={`rounded-lg bg-white ring-1 ${ticket.overdue ? "ring-red-300" : "ring-slate-200"}`}>
      <details>
        <summary className="cursor-pointer list-none p-4">
          <TicketSummary ticket={ticket} showDepartment={isAdmin} />
        </summary>

        <div className="space-y-4 border-t border-slate-200 p-4">
          <p className="text-sm text-slate-700">
            <span className="text-slate-600">Why this priority: </span>
            {ticket.priorityReason}
          </p>
          {/* Held reports have no public page (it would 404), so the link only shows once a report is live. */}
          {!isHeld(ticket) && (
            <Link href={`/track/${ticket.id}`} className="text-sm text-blue-700 underline">
              Public page, map and photos →
            </Link>
          )}
          <ReopenPhoto ticket={ticket} />

          {isAdmin && pendingReview && (
            <ReviewPanel
              department={ticket.department}
              note={note}
              onNoteChange={setNote}
              busy={busy}
              onUpdate={update}
            />
          )}

          <LifecycleActions ticket={ticket} isAdmin={isAdmin} busy={busy} onUpdate={update} onResolve={resolve} />

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold">Conversation with the citizen (anonymous, auto-translated)</h3>
            <MessageThread messages={ticket.messages ?? []} viewer="staff" onSend={sendMessage} />
          </div>

          <NoteForm ticketId={ticket.id} note={note} onNoteChange={setNote} onUpdate={update} />

          {isAdmin && <AdminOverrides ticket={ticket} onUpdate={update} />}
        </div>
      </details>
    </li>
  );
}
