import type { Translate } from "@/lib/i18n";
import { STATUSES, type Status } from "@/lib/types";

/** Progress bar: Reported → In Progress → Resolved, with the current step marked for screen readers. */
export default function StatusSteps({ status: current, t }: { status: Status; t: Translate }) {
  const currentStep = STATUSES.indexOf(current);
  return (
    <ol aria-label={t("ticket.progress")} className="grid grid-cols-3 gap-2">
      {STATUSES.map((status, step) => (
        <li
          key={status}
          aria-current={step === currentStep ? "step" : undefined}
          className={`flex items-center justify-center rounded-md px-2 py-2 text-center text-sm font-medium ${
            step <= currentStep ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"
          }`}
        >
          {t(`status.${status}`)}
        </li>
      ))}
    </ol>
  );
}
