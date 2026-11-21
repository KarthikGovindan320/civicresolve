"use client";

import { useState } from "react";
import { compactButtonClass, compactFieldClass } from "@/components/ui";
import { downscaleSelected } from "@/lib/client/image";
import { LIMITS } from "@/lib/types";

/**
 * Marks an in-progress ticket as fixed. Departments must attach an after
 * photo, which Gemini compares with the citizen's report; the city admin may
 * close without one.
 */
export default function ResolveForm({
  busy,
  photoRequired,
  onResolve,
}: {
  busy: boolean;
  photoRequired: boolean;
  onResolve: (note: string, afterPhoto: Blob | null) => void;
}) {
  const [note, setNote] = useState("");
  const [afterPhoto, setAfterPhoto] = useState<Blob | null>(null);

  function resolve(event: React.FormEvent) {
    event.preventDefault();
    onResolve(note, afterPhoto);
  }

  return (
    <form onSubmit={resolve} className="flex flex-wrap items-end gap-2 rounded-md bg-emerald-50 p-3">
      <label className="text-sm">
        After photo{photoRequired ? " (required)" : " (optional for admin)"}{" "}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          required={photoRequired}
          onChange={async (event) => setAfterPhoto(await downscaleSelected(event.target))}
          className="block text-sm"
        />
      </label>
      <label className="flex-1 text-sm">
        What was done?{" "}
        <input
          required
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={LIMITS.staffNote}
          className={`${compactFieldClass} w-full`}
        />
      </label>
      <button disabled={busy} className={`${compactButtonClass} bg-emerald-700 text-white`}>
        {busy ? "Checking photo with Gemini…" : "Mark fixed"}
      </button>
    </form>
  );
}
