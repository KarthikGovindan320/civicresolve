import { isPendingReview } from "@/lib/types";
import AcceptForm from "./actions/AcceptForm";
import ResolutionSummary from "./actions/ResolutionSummary";
import ResolveForm from "./actions/ResolveForm";
import TransferForm from "./actions/TransferForm";
import type { StaffTicket } from "./types";
import type { UpdateTicket } from "./useTicketActions";

/**
 * The actions that depend on where the ticket is in its lifecycle: accept a
 * reported ticket (once it has passed review), mark an in-progress one fixed,
 * show the proof for a resolved one, and transfer anything not yet resolved.
 */
export default function LifecycleActions({
  ticket,
  isAdmin,
  busy,
  onUpdate,
  onResolve,
}: {
  ticket: StaffTicket;
  isAdmin: boolean;
  busy: boolean;
  onUpdate: UpdateTicket;
  onResolve: (note: string, afterPhoto: Blob | null) => void;
}) {
  return (
    <>
      {ticket.status === "Reported" && !isPendingReview(ticket) && <AcceptForm busy={busy} onUpdate={onUpdate} />}
      {ticket.status === "In Progress" && <ResolveForm busy={busy} photoRequired={!isAdmin} onResolve={onResolve} />}
      {ticket.status === "Resolved" && ticket.resolution && (
        <ResolutionSummary resolution={ticket.resolution} citizenConfirmation={ticket.citizenConfirmation} />
      )}
      {ticket.status !== "Resolved" && (
        <TransferForm currentDepartment={ticket.department} busy={busy} onUpdate={onUpdate} />
      )}
    </>
  );
}
