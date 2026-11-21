"use client";

import { useState } from "react";
import { compactButtonClass, compactFieldClass } from "@/components/ui";
import { DEPARTMENTS, LIMITS, type Department } from "@/lib/types";
import type { UpdateTicket } from "../useTicketActions";

/** Hands a ticket to another department, with a reason that is recorded on the public timeline. */
export default function TransferForm({
  currentDepartment,
  busy,
  onUpdate,
}: {
  currentDepartment: Department;
  busy: boolean;
  onUpdate: UpdateTicket;
}) {
  const [targetDepartment, setTargetDepartment] = useState("");
  const [reason, setReason] = useState("");

  function transfer(event: React.FormEvent) {
    event.preventDefault();
    onUpdate({ action: "transfer", department: targetDepartment, note: reason }, `transferred to ${targetDepartment}`);
  }

  return (
    <form onSubmit={transfer} className="flex flex-wrap items-end gap-2">
      <label className="text-sm">
        Not ours? Transfer to{" "}
        <select
          required
          value={targetDepartment}
          onChange={(event) => setTargetDepartment(event.target.value)}
          className={compactFieldClass}
        >
          <option value="">Choose…</option>
          {DEPARTMENTS.filter((department) => department !== currentDepartment).map((department) => (
            <option key={department}>{department}</option>
          ))}
        </select>
      </label>
      <label className="flex-1 text-sm">
        Reason{" "}
        <input
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={LIMITS.staffNote}
          className={`${compactFieldClass} w-full`}
        />
      </label>
      <button disabled={busy} className={`${compactButtonClass} ring-1 ring-slate-300`}>
        Transfer
      </button>
    </form>
  );
}
