"use client";

import { compactButtonClass, compactFieldClass } from "@/components/ui";
import { LIMITS } from "@/lib/types";
import type { UpdateTicket } from "../useTicketActions";

/** Adds a staff note to the ticket's public timeline. */
export default function NoteForm({
  ticketId,
  note,
  onNoteChange,
  onUpdate,
}: {
  ticketId: string;
  note: string;
  onNoteChange: (note: string) => void;
  onUpdate: UpdateTicket;
}) {
  function addNote(event: React.FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    onUpdate({ action: "note", note }, "note added");
    onNoteChange("");
  }

  return (
    <form onSubmit={addNote} className="flex gap-2">
      <label htmlFor={`note-${ticketId}`} className="sr-only">
        Public timeline note for {ticketId}
      </label>
      <input
        id={`note-${ticketId}`}
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
        placeholder="Add a note to the public timeline"
        className={`${compactFieldClass} min-w-40 flex-1`}
        maxLength={LIMITS.staffNote}
      />
      <button className={`${compactButtonClass} bg-slate-900 text-white`}>Add note</button>
    </form>
  );
}
