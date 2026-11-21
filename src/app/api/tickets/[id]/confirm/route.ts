// =============================================================================
// POST /api/tickets/[id]/confirm: the citizen closes the loop
// -----------------------------------------------------------------------------
// After a department reports a fix, the citizen (authenticated by their private
// link token) either:
//   • confirms → the ticket is closed as genuinely resolved, or
//   • reopens  → it returns to the department as In Progress, with the
//                citizen's note and an optional new photo, and the reopen
//                count goes up (visible to the admin as a quality signal).
// A ticket is "resolved" when the person affected agrees it is, not only when
// staff say so. The rules live in lib/services/resolution.ts.
// =============================================================================

import { NextResponse } from "next/server";
import { failWith, formText, loadTicketForReporter, readFormData, updateTicketAtomically } from "@/lib/http";
import { log } from "@/lib/log";
import { photoKey } from "@/lib/photos";
import { success } from "@/lib/result";
import { applyCitizenAnswer, parseCitizenAnswer } from "@/lib/services/resolution";
import { LIMITS } from "@/lib/types";
import { readImage } from "@/lib/uploads";
import { toPrivate } from "@/lib/workflow";

const CONFIRM_BUDGET = { bucket: "confirm" };

/** Record the citizen's verdict on a reported fix: `decision` is "confirm" or "reopen". */
export async function POST(req: Request, ctx: RouteContext<"/api/tickets/[id]/confirm">) {
  const { id } = await ctx.params;
  // Only a reporter of this ticket can confirm or reopen it.
  const access = await loadTicketForReporter(req, id, CONFIRM_BUDGET);
  if (!access.ok) return failWith(access);
  const { ticket, db } = access;

  const body = await readFormData(req);
  if (!body.ok) return failWith(body);
  const { form } = body;
  const answer = parseCitizenAnswer(ticket, formText(form, "decision"), formText(form, "note", LIMITS.citizenNote));
  if (!answer.ok) return failWith(answer);
  // Only a reopen carries evidence: a new photo of what is still wrong.
  const photo = answer.decision === "reopen" ? await readImage(form.get("photo")) : success({ part: null });
  if (!photo.ok) return failWith(photo);
  if (photo.part) await db.putImage(photoKey(ticket.id, "reopen"), photo.part);

  const now = new Date().toISOString();
  const result = await updateTicketAtomically(db, ticket.id, (current) =>
    applyCitizenAnswer(current, { ...answer, hasPhoto: Boolean(photo.part), now }),
  );
  if (!result.ok) return failWith(result);
  const updated = result.ticket;
  if (answer.decision === "confirm") log.info("ticket_confirmed", { id: ticket.id });
  else log.info("ticket_reopened", { id: ticket.id, reopenCount: updated.reopenCount });
  return NextResponse.json(toPrivate(updated));
}
