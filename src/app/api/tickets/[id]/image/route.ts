import { CITIZEN_KEY_HEADER } from "@/lib/headers";
import { fail, findTicket } from "@/lib/http";
import { isPhotoVariant, photoKey, type PhotoVariant } from "@/lib/photos";
import { safeEqual } from "@/lib/security";
import { store } from "@/lib/store";
import { isHeld, type Ticket } from "@/lib/types";
import { isReporter, photoSignature } from "@/lib/workflow";

// Serves a ticket's photos:
//   ?v=before (default) → the citizen's original photo
//   ?v=after            → the department's proof-of-fix photo
//   ?v=reopen           → the citizen's photo when reopening
// Photos are stored apart from ticket records, so dashboards load fast and only
// fetch an image when someone opens that ticket.
// `v` is checked against the photo variants (own keys only, so "constructor" or "toString" can't
// slip through), and the stored MIME type was set from the file signature at upload.
const DEFAULT_VARIANT: PhotoVariant = "before";
const IMAGE_CACHE_SECONDS = 3600;

const notFound = () => fail(404, "Photo not found.");

/**
 * Security: photos of tickets held for review (reports sent without phone verification, or
 * rejected by the admin) are hidden from the public just like the tickets themselves. Ticket ids
 * are sequential and easy to guess, so the id alone must not be enough to fetch them. A held
 * photo is served only with either
 *   - `s`: the server-issued signature for this ticket and photo (see photoSignature), which is
 *     embedded only in pages the viewer may already see, or
 *   - `k` / the citizen key header: the reporter's own private-link token.
 * Anything else gets the same 404 as a missing photo, so the response doesn't even reveal that a
 * held ticket exists.
 */
function mayViewHeldPhoto(req: Request, ticket: Ticket, variant: PhotoVariant): boolean {
  const params = new URL(req.url).searchParams;
  const signature = params.get("s");
  if (signature && safeEqual(signature, photoSignature(ticket.id, variant))) return true;
  return isReporter(ticket, params.get("k") ?? req.headers.get(CITIZEN_KEY_HEADER));
}

/** Return one of a ticket's photos as binary image data. */
export async function GET(req: Request, ctx: RouteContext<"/api/tickets/[id]/image">) {
  const { id } = await ctx.params;
  const variant = new URL(req.url).searchParams.get("v") ?? DEFAULT_VARIANT;
  if (!isPhotoVariant(variant)) return notFound();

  const db = store();
  const ticket = await findTicket(db, id);
  if (!ticket) return notFound(); // no orphaned photos are served once a ticket is deleted
  const held = isHeld(ticket);
  if (held && !mayViewHeldPhoto(req, ticket, variant)) return notFound();

  const image = await db.getImage(photoKey(ticket.id, variant));
  if (!image) return notFound();
  return new Response(Buffer.from(image.data, "base64"), {
    headers: {
      "Content-Type": image.mimeType,
      // Security: held photos are marked private so shared caches and proxies never keep a copy
      // that could be served to someone without the signature.
      "Cache-Control": `${held ? "private" : "public"}, max-age=${IMAGE_CACHE_SECONDS}`,
    },
  });
}
