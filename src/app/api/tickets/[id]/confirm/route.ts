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
// staff say so.
// =============================================================================

import { NextResponse } from "next/server";
import {
  ERROR_MESSAGES,
  fail,
  failWith,
  formText,
  loadTicketForReporter,
  readFormData,
  updateTicketAtomically,
} from "@/lib/http";
import { log } from "@/lib/log";
import { failure, success } from "@/lib/result";
import { clientIp, rateLimit } from "@/lib/security";
import type { Store } from "@/lib/store";
import { LIMITS, type Ticket } from "@/lib/types";
import { readImage } from "@/lib/uploads";
import { appendHistory, appendMessage, makeMessage, toPrivate } from "@/lib/workflow";

/** Image-store key suffix for the photo a citizen attaches when reopening. */
const REOPEN_PHOTO_SUFFIX = "-reopen";
const NOT_RESOLVED_YET = "This issue hasn't been marked fixed yet.";

/** Apply the citizen's verdict only while the latest stored ticket is still awaiting one. */
const whileResolved = (current: Ticket, verdict: (ticket: Ticket) => Ticket) =>
  current.status === "Resolved" ? success({ ticket: verdict(current) }) : failure(409, NOT_RESOLVED_YET);

const citizenMessage = (text: string, now: string) =>
  makeMessage({ from: "citizen", text, lang: "en", translation: null }, now);

/** The ticket after the citizen agrees it is fixed. */
function confirmFix(ticket: Ticket, note: string, now: string): Ticket {
  const confirmed: Ticket = { ...ticket, updatedAt: now, citizenConfirmation: "confirmed" };
  return appendMessage(
    appendHistory(confirmed, { status: "Resolved", at: now, note: "Citizen confirmed the fix ✔" }),
    citizenMessage(note || "Confirmed: it's fixed. Thank you!", now),
  );
}

/** The ticket after the citizen says it is not fixed: back to the department as In Progress. */
function reopen(ticket: Ticket, note: string, hasPhoto: boolean, now: string): Ticket {
  const reopened: Ticket = {
    ...ticket,
    status: "In Progress",
    resolvedAt: null,
    updatedAt: now,
    citizenConfirmation: "reopened",
    reopenCount: (ticket.reopenCount ?? 0) + 1,
    hasReopenPhoto: hasPhoto, // lets the department see the citizen's evidence
  };
  return appendMessage(
    appendHistory(reopened, { status: "In Progress", at: now, note: `Reopened by citizen: ${note}` }),
    citizenMessage(`Not fixed: ${note}`, now),
  );
}

/** The ticket and the citizen's note, shared by both decisions. */
interface Verdict {
  db: Store;
  ticket: Ticket;
  note: string;
  now: string;
}

/** The citizen agrees the issue is fixed. */
async function handleConfirm({ db, ticket, note, now }: Verdict) {
  const result = await updateTicketAtomically(db, ticket.id, (current) =>
    whileResolved(current, (resolved) => confirmFix(resolved, note, now)),
  );
  if (!result.ok) return failWith(result);
  log.info("ticket_confirmed", { id: ticket.id });
  return NextResponse.json(toPrivate(result.ticket));
}

/** The citizen says it is not fixed: a reason is required, a new photo is optional. */
async function handleReopen({ db, ticket, note, now }: Verdict, photoField: FormDataEntryValue | null) {
  if (!note) return fail(400, "Tell the department what is still wrong.");
  const photo = await readImage(photoField);
  if (!photo.ok) return failWith(photo);
  if (photo.part) await db.putImage(`${ticket.id}${REOPEN_PHOTO_SUFFIX}`, photo.part);
  const result = await updateTicketAtomically(db, ticket.id, (current) =>
    whileResolved(current, (resolved) => reopen(resolved, note, Boolean(photo.part), now)),
  );
  if (!result.ok) return failWith(result);
  log.info("ticket_reopened", { id: ticket.id, reopenCount: result.ticket.reopenCount });
  return NextResponse.json(toPrivate(result.ticket));
}

/** Record the citizen's verdict on a reported fix: `decision` is "confirm" or "reopen". */
export async function POST(req: Request, ctx: RouteContext<"/api/tickets/[id]/confirm">) {
  const { id } = await ctx.params;
  // Only a reporter of this ticket can confirm or reopen it.
  const access = await loadTicketForReporter(req, id);
  if (!access.ok) return failWith(access);
  const { ticket, db } = access;
  if (!rateLimit(`confirm:${clientIp(req)}`).ok) return fail(429, "Too many requests. Please wait a few minutes.");
  if (ticket.status !== "Resolved") return fail(409, NOT_RESOLVED_YET);

  const form = await readFormData(req);
  if (!form) return fail(400, ERROR_MESSAGES.expectedFormData);
  const verdict: Verdict = {
    db,
    ticket,
    note: formText(form, "note", LIMITS.citizenNote),
    now: new Date().toISOString(),
  };
  const decision = form.get("decision");
  if (decision === "confirm") return handleConfirm(verdict);
  if (decision === "reopen") return handleReopen(verdict, form.get("photo"));
  return fail(400, "Decision must be 'confirm' or 'reopen'.");
}
