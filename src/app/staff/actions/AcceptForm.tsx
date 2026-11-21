"use client";

import { useState } from "react";
import { compactButtonClass, compactFieldClass } from "@/components/ui";
import { LIMITS } from "@/lib/types";
import type { UpdateTicket } from "../useTicketActions";

/** Accepts a newly reported ticket, optionally promising a fix date and adding a note for the citizen. */
export default function AcceptForm({ busy, onUpdate }: { busy: boolean; onUpdate: UpdateTicket }) {
  const [fixDate, setFixDate] = useState("");
  const [note, setNote] = useState("");
  // A promised date can't be in the past.
  const today = new Date().toISOString().slice(0, 10);

  function accept(event: React.FormEvent) {
    event.preventDefault();
    onUpdate({ action: "acknowledge", expectedFixDate: fixDate || null, note }, "accepted");
  }

  return (
    <form onSubmit={accept} className="flex flex-wrap items-end gap-2 rounded-md bg-emerald-50 p-3">
      <label className="text-sm">
        Promise a fix by{" "}
        <input
          type="date"
          min={today}
          value={fixDate}
          onChange={(event) => setFixDate(event.target.value)}
          className={compactFieldClass}
        />
      </label>
      <label className="flex-1 text-sm">
        Note to citizen (optional){" "}
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={LIMITS.staffNote}
          className={`${compactFieldClass} w-full`}
        />
      </label>
      <button disabled={busy} className={`${compactButtonClass} bg-emerald-700 text-white`}>
        Accept issue
      </button>
    </form>
  );
}
