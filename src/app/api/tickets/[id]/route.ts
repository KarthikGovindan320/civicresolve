// =============================================================================
// /api/tickets/[id]: read one ticket / manage it (department or admin)
// -----------------------------------------------------------------------------
// GET   → citizens track a ticket by ID. With their private link token
//         (x-citizen-key header or ?k=) they also see the conversation.
// PATCH → the staff workflow, one `action` per request:
//           "acknowledge" → department accepts the ticket and commits to
//                           a fix date (status → In Progress)
//           "transfer"    → "not ours": hand it to the right department,
//                           with a reason (visible on the public timeline)
//           "note"        → add a public timeline note
//           "review"      → admin only: approve or reject an unverified report
//           "update"      → admin only: override status / category /
//                           department / priority
//         The rules for each action live in lib/services/ticket-actions.ts.
//         Resolving needs proof, so it has its own endpoint: ./resolve
// Every change that affects the citizen notifies the reporters (in-app message
// plus optional email).
// =============================================================================

import { NextResponse } from "next/server";
import { authenticateStaff, canActOn, isAdminRole } from "@/lib/auth";
import { CITIZEN_KEY_HEADER } from "@/lib/headers";
import {
  ERROR_MESSAGES,
  NO_STORE_HEADERS,
  baseUrl,
  fail,
  failWith,
  findTicket,
  loadTicketForStaff,
  readJsonBody,
  updateTicketAtomically,
} from "@/lib/http";
import { log } from "@/lib/log";
import { notifyReporters } from "@/lib/notify";
import { failure } from "@/lib/result";
import { TicketActionSchema } from "@/lib/schemas";
import { applyTicketAction } from "@/lib/services/ticket-actions";
import { store } from "@/lib/store";
import { isHeld } from "@/lib/types";
import { isReporter, toPrivate, toPublic } from "@/lib/workflow";

/** Staff actions are cheap but each may email every reporter: a budget no real shift comes near. */
const STAFF_ACTION_BUDGET = { bucket: "staff-action", max: 120 };

/** Read one ticket: the private view for its own reporters and responsible staff, the public view otherwise. */
export async function GET(req: Request, ctx: RouteContext<"/api/tickets/[id]">) {
  const staff = authenticateStaff(req);
  if (!staff.ok) return failWith(staff);
  const { role } = staff;
  const { id } = await ctx.params;
  const ticket = await findTicket(store(), id);
  if (!ticket) return fail(404, ERROR_MESSAGES.ticketNotFound);
  const token = req.headers.get(CITIZEN_KEY_HEADER) ?? new URL(req.url).searchParams.get("k");
  const isOwnReporter = isReporter(ticket, token);
  // Held (unverified / rejected) reports exist only for their reporter and the admin.
  if (isHeld(ticket) && !isOwnReporter && !isAdminRole(role)) return fail(404, ERROR_MESSAGES.ticketNotFound);
  const seesPrivateView = isOwnReporter || canActOn(role, ticket);
  return NextResponse.json(seesPrivateView ? toPrivate(ticket) : toPublic(ticket), { headers: NO_STORE_HEADERS });
}

/** Apply one staff action to a ticket, save it, and tell the reporters if it concerns them. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/tickets/[id]">) {
  const { id } = await ctx.params;
  const access = await loadTicketForStaff(req, id, STAFF_ACTION_BUDGET);
  if (!access.ok) return failWith(access);
  const { ticket, role, db } = access;

  const action = await readJsonBody(req, TicketActionSchema);
  if (!action) return fail(400, "Unknown action.");
  const origin = baseUrl(req);

  // The action is applied to the latest stored version inside an atomic update, and
  // permission is re-checked there in case the ticket was transferred meanwhile.
  const context = { role, now: new Date().toISOString() };
  const result = await updateTicketAtomically(db, ticket.id, (current) =>
    canActOn(role, current)
      ? applyTicketAction(current, action, context)
      : failure(403, ERROR_MESSAGES.otherDepartment),
  );
  if (!result.ok) return failWith(result);
  const { ticket: updated, notice, audit } = result;

  if (audit) log.info(audit.event, audit.fields);
  if (notice) await notifyReporters(updated, notice.subject, notice.text, origin);
  return NextResponse.json(toPrivate(updated));
}
