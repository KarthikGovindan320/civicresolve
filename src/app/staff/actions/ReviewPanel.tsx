"use client";

import { compactFieldClass } from "@/components/ui";
import { LIMITS, type Department } from "@/lib/types";
import type { UpdateTicket } from "../useTicketActions";

/**
 * City admin's screening of a report sent without phone verification: approve
 * it into the department's queue, or reject it. Until then the report is held
 * back from the department and from the public pages.
 */
export default function ReviewPanel({
  department,
  note,
  onNoteChange,
  busy,
  onUpdate,
}: {
  department: Department;
  /** Optional note shown to the citizen with the decision. */
  note: string;
  onNoteChange: (note: string) => void;
  busy: boolean;
  onUpdate: UpdateTicket;
}) {
  return (
    <div className="space-y-2 rounded-md bg-amber-50 p-3 ring-1 ring-amber-200">
      <p className="text-sm text-amber-900">
        Sent <strong>without phone verification</strong>, so it was classified by rules, not Gemini. Check it, correct
        the category below if needed, then approve it into {department}&apos;s queue or reject it.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 text-sm">
          Note (optional, shown to the citizen){" "}
          <input
            className={compactFieldClass}
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            maxLength={LIMITS.staffNote}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => onUpdate({ action: "review", decision: "approve", note }, "approved")}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onUpdate({ action: "review", decision: "reject", note }, "rejected")}
          className="rounded-md px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-red-300 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
