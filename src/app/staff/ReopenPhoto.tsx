import Photo from "@/components/Photo";
import { photoPath } from "@/lib/photos";
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
      <Photo
        src={photoPath(ticket.id, "reopen", ticket.updatedAt)}
        alt={`New photo from the citizen after reopening ${ticket.id}`}
        className="max-h-48"
      />
      <figcaption className="text-xs text-slate-600">Citizen&apos;s new photo (issue reopened)</figcaption>
    </figure>
  );
}
