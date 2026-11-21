// =============================================================================
// POST /api/tickets/[id]/resolve: proof of fix
// -----------------------------------------------------------------------------
// A department can't just flip a ticket to "Resolved". It must upload an "after"
// photo of the site. Gemini compares it with the citizen's "before" photo and the
// issue description and records a verdict (fixed / not_fixed / unclear) with a
// reason. The ticket then waits for the citizen to confirm or reopen it
// (./confirm); if they don't answer it auto-closes after AUTO_CLOSE_DAYS.
// That's the "resolution" half of the brief's "submission → tracking →
// resolution", with accountability built in. The rules live in
// lib/services/resolution.ts; this file parses, authorises, saves and responds.
// =============================================================================

import { NextResponse } from "next/server";
import { roleLabel } from "@/lib/auth";
import { baseUrl, failWith, formText, loadTicketForStaff, readFormData, updateTicketAtomically } from "@/lib/http";
import { log } from "@/lib/log";
import { notifyReporters } from "@/lib/notify";
import { photoKey } from "@/lib/photos";
import { assessFix, fixSummary, proofProblem, resolveProblem, resolveTicket } from "@/lib/services/resolution";
import { LIMITS } from "@/lib/types";
import { readImage } from "@/lib/uploads";
import { toPrivate } from "@/lib/workflow";

/** Each resolve may call Gemini to check the photo, so it has its own, smaller budget. */
const RESOLVE_BUDGET = { bucket: "resolve", max: 30 };

/** Mark a ticket fixed, with a note and an after-photo that Gemini checks against the original report. */
export async function POST(req: Request, ctx: RouteContext<"/api/tickets/[id]/resolve">) {
  const { id } = await ctx.params;
  // Staff only, and only the department that owns the ticket (or the admin).
  const access = await loadTicketForStaff(req, id, RESOLVE_BUDGET);
  if (!access.ok) return failWith(access);
  const { ticket, role, db } = access;
  const notResolvable = resolveProblem(role, ticket);
  if (notResolvable) return failWith(notResolvable);

  const body = await readFormData(req);
  if (!body.ok) return failWith(body);
  const note = formText(body.form, "note", LIMITS.staffNote);
  const photo = await readImage(body.form.get("photo"));
  if (!photo.ok) return failWith(photo);
  const afterPhoto = photo.part;
  const badProof = proofProblem(role, { note, hasPhoto: Boolean(afterPhoto) });
  if (badProof) return failWith(badProof);
  const origin = baseUrl(req);

  const by = roleLabel(role);
  const resolution = await assessFix(db, ticket, { note, afterPhoto, by, at: new Date().toISOString() });
  if (afterPhoto) await db.putImage(photoKey(ticket.id, "after"), afterPhoto);
  // Saved against the latest stored version: if someone else resolved or transferred
  // the ticket while Gemini was checking the photo, this request is refused instead.
  const result = await updateTicketAtomically(db, ticket.id, (current) => resolveTicket(current, role, resolution));
  if (!result.ok) return failWith(result);
  const resolved = result.ticket;
  log.info("ticket_resolved", { id: ticket.id, by, aiVerdict: resolution.aiVerdict });
  await notifyReporters(
    resolved,
    "Your issue has been marked fixed: please confirm",
    `${fixSummary(resolution)}\nIf it's not actually fixed, open your private link and press "Not fixed: reopen".`,
    origin,
  );
  return NextResponse.json(toPrivate(resolved));
}
