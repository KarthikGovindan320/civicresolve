import type { StaffTicket } from "./types";

/**
 * The citizen's new evidence when they reopened the issue. Without this the
 * department never sees it. Renders nothing unless the ticket was reopened
 * with a photo.
 */
export default function ReopenPhoto({ ticket }: { ticket: StaffTicket }) {
  if (!ticket.hasReopenPhoto || ticket.citizenConfirmation !== "reopened") return null;
  return (
    <figure>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/tickets/${ticket.id}/image?v=reopen&t=${encodeURIComponent(ticket.updatedAt)}`}
        alt={`New photo from the citizen after reopening ${ticket.id}`}
        className="max-h-48 rounded-md ring-1 ring-slate-200"
      />
      <figcaption className="text-xs text-slate-600">Citizen&apos;s new photo (issue reopened)</figcaption>
    </figure>
  );
}
