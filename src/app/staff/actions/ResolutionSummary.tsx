import { formatDateTime } from "@/lib/format";
import type { PublicTicket, Resolution } from "@/lib/types";

/** Read-only record of a resolved ticket: the reported fix, Gemini's check of the after photo, and the citizen's answer. */
export default function ResolutionSummary({
  resolution,
  citizenConfirmation,
}: {
  resolution: Resolution;
  citizenConfirmation: PublicTicket["citizenConfirmation"];
}) {
  return (
    <div className="rounded-md bg-slate-50 p-3 text-sm">
      <p>
        <strong>Fix reported:</strong> {resolution.note} ({resolution.by}, {formatDateTime(resolution.at)})
      </p>
      <p>
        <strong>Gemini check:</strong> {resolution.aiVerdict.replace("_", " ")}. {resolution.aiReason}
      </p>
      <p>
        <strong>Citizen:</strong> {citizenConfirmation ?? "n/a"}
      </p>
    </div>
  );
}
