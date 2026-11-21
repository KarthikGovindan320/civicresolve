"use client";

import { compactFieldClass } from "@/components/ui";
import { CATEGORIES, DEPARTMENTS, PRIORITIES, STATUSES } from "@/lib/types";
import type { StaffTicket } from "../types";
import type { UpdateTicket } from "../useTicketActions";

/**
 * City admin's overrides of the AI's triage: status, category, department and
 * priority. Each change is saved as soon as it is selected, keeping a human
 * in the loop over every automatic decision.
 */
export default function AdminOverrides({ ticket, onUpdate }: { ticket: StaffTicket; onUpdate: UpdateTicket }) {
  const basePriority = ticket.basePriority ?? ticket.priority;
  return (
    <fieldset className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-xs font-medium text-slate-600">Admin overrides</legend>
      <OverrideSelect
        label="Status"
        value={ticket.status}
        options={STATUSES}
        onChange={(status) => onUpdate({ action: "update", status }, "status updated")}
      />
      <OverrideSelect
        label="Category"
        value={ticket.category}
        options={CATEGORIES}
        onChange={(category) => onUpdate({ action: "update", category }, "re-categorised")}
      />
      <OverrideSelect
        label="Department"
        value={ticket.department}
        options={DEPARTMENTS}
        onChange={(department) => onUpdate({ action: "update", department }, "re-assigned")}
      />
      <OverrideSelect
        label="Priority"
        value={basePriority}
        options={PRIORITIES}
        onChange={(priority) => onUpdate({ action: "update", priority }, "priority set")}
      />
      {/* The select shows the admin's base priority; the effective one can be higher (life-safety rule or
          several reporters). Saying so keeps the two values from looking like a bug. */}
      {ticket.priority !== basePriority && (
        <p role="note" className="basis-full text-xs text-amber-800">
          Effective priority is {ticket.priority}: raised automatically by the life-safety rule or by the number of
          reporters.
        </p>
      )}
    </fieldset>
  );
}

function OverrideSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs">
      {label}{" "}
      <select className={compactFieldClass} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
