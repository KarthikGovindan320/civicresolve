// =============================================================================
// Staff actions on a ticket (the logic behind PATCH /api/tickets/[id])
// -----------------------------------------------------------------------------
//   review      → the city admin approves or rejects a report sent without
//                 phone verification
//   acknowledge → the department accepts the ticket and commits to a fix date
//   transfer    → "not ours": hand it to the right department, with a reason
//   note        → add a note to the public timeline
//   update      → admin only: override status / category / department / priority
//                 (a human in the loop over the AI's decisions)
// Each action is a pure function of (ticket, input, context): it returns the
// updated ticket, or the error to answer with. Nothing here touches the
// database, the network or the logger, which keeps every rule unit-testable
// (tests/ticket-actions.test.ts); the route persists and notifies.
// =============================================================================
import { isAdminRole, roleLabel } from "../auth";
import { failure, type Result } from "../result";
import { recomputePriority } from "../rules";
import type { AcknowledgeInput, NoteInput, ReviewInput, TicketAction, TransferInput, UpdateInput } from "../schemas";
import { CATEGORY_DEPARTMENT, fmtDay, isPendingReview, type Resolution, type Role, type Ticket } from "../types";
import { appendHistory, appendMessage, systemMessage } from "../workflow";

/** Who is acting and when. Passed in so the actions stay deterministic. */
export interface ActionContext {
  role: Role;
  /** ISO timestamp of the request. */
  now: string;
}

/** What the reporters are told about a change: an email subject, and text that also goes into the conversation. */
export interface Notice {
  subject: string;
  text: string;
}

/** A structured log line describing the change, written by the route once the action succeeds. */
export interface AuditEvent {
  event: string;
  fields: Record<string, unknown>;
}

export type ActionResult = Result<{ ticket: Ticket; notice: Notice | null; audit: AuditEvent | null }>;

function done(ticket: Ticket, notice: Notice | null = null, audit: AuditEvent | null = null): ActionResult {
  return { ok: true, ticket, notice, audit };
}

/** " <note>" when there is a note, otherwise nothing: appended to a sentence that already ends in a full stop. */
const trailingNote = (note: string) => (note ? ` ${note}` : "");

/**
 * The city admin screens reports that were sent without phone verification.
 * Approve → the report enters the department's normal queue. Reject → it stays
 * stored (for any later investigation) but is hidden everywhere.
 */
export function reviewTicket(ticket: Ticket, input: ReviewInput, { role, now }: ActionContext): ActionResult {
  if (!isAdminRole(role)) return failure(403, "Only the city admin can review reports.");
  if (!isPendingReview(ticket)) return failure(400, "This report is not waiting for review.");
  const { decision, note } = input;
  if (!decision) return failure(400, "Decision must be 'approve' or 'reject'.");
  const audit = { event: "ticket_reviewed", fields: { id: ticket.id, decision } };

  if (decision === "approve") {
    const text = `Reviewed by the city admin and sent to ${ticket.department}.${trailingNote(note)}`;
    const approved = appendHistory(
      { ...ticket, verification: "approved" },
      { status: ticket.status, at: now, note: text },
    );
    return done(approved, { subject: "Your report was accepted for action", text }, audit);
  }
  const rejected = appendHistory(
    { ...ticket, verification: "rejected" },
    { status: ticket.status, at: now, note: `Not accepted after review${note ? `: ${note}` : "."}` },
  );
  const text = `After review, this report was not accepted.${note ? ` Reason: ${note}` : ""}`;
  return done(rejected, { subject: "Your report was not accepted", text }, audit);
}

/**
 * The department takes ownership and makes a public commitment (optionally with a fix date).
 * Only a new report can be accepted: a resolved ticket goes back to work through the
 * citizen's reopen or an admin status change, never by being "accepted" again, and a
 * report waiting for review must be approved first.
 */
export function acknowledgeTicket(ticket: Ticket, input: AcknowledgeInput, { role, now }: ActionContext): ActionResult {
  if (ticket.status !== "Reported") return failure(400, "Only a newly reported issue can be accepted.");
  if (isPendingReview(ticket)) return failure(400, "This report is waiting for the city admin's review.");
  const { expectedFixDate, note } = input;
  const commitment = expectedFixDate ? ` and expects to fix it by ${fmtDay(expectedFixDate)}` : "";
  const text = `${roleLabel(role)} accepted this issue${commitment}.${trailingNote(note)}`;
  const acknowledged = appendHistory(
    { ...ticket, status: "In Progress", acknowledgedAt: now, expectedFixDate, resolvedAt: null },
    { status: "In Progress", at: now, note: text },
  );
  return done(
    acknowledged,
    { subject: "Your issue is being worked on", text },
    { event: "ticket_acknowledged", fields: { id: ticket.id, by: roleLabel(role), expectedFixDate } },
  );
}

/**
 * "Not our department": re-route with a mandatory reason, so hand-offs are
 * accountable and the citizen understands the delay.
 */
export function transferTicket(ticket: Ticket, input: TransferInput, { now }: ActionContext): ActionResult {
  const { department: destination, note } = input;
  if (!destination || destination === ticket.department) return failure(400, "Choose a different, valid department.");
  if (!note) return failure(400, "Give a reason for the transfer.");
  const text = `Transferred from ${ticket.department} to ${destination}: ${note}`;
  const transferred = appendHistory(
    {
      ...ticket,
      department: destination,
      transfers: (ticket.transfers ?? 0) + 1,
      status: "Reported", // back in the new department's "to accept" queue
      acknowledgedAt: null,
      expectedFixDate: null,
    },
    { status: "Reported", at: now, note: text },
  );
  return done(
    transferred,
    { subject: "Your issue was passed to the right department", text },
    { event: "ticket_transferred", fields: { id: ticket.id, from: ticket.department, to: destination } },
  );
}

/** Add a staff note to the public timeline. Reporters are not notified. */
export function addTicketNote(ticket: Ticket, input: NoteInput, { role, now }: ActionContext): ActionResult {
  const { note } = input;
  if (!note) return failure(400, "Note is empty.");
  const noted = appendHistory(
    { ...ticket, adminNotes: [...ticket.adminNotes, note] },
    { status: ticket.status, at: now, note: `${roleLabel(role)}: ${note}` },
  );
  return done(noted);
}

/** The resolution recorded when the admin closes a ticket by status override, without an after-photo. */
function adminResolution(note: string, by: string, now: string): Resolution {
  return {
    note: note || "Marked resolved by the city admin.",
    hasPhoto: false,
    aiVerdict: "unclear",
    aiReason: "No after-photo was provided.",
    by,
    at: now,
  };
}

/**
 * Status override: each change is appended to the public history (with the
 * admin's note), and resolvedAt is stamped so the dashboard can report average
 * time-to-resolution. Moving a ticket out of Resolved also clears the proof of
 * fix and the citizen's verdict, so a reopened ticket never shows a stale fix.
 * Without a status change, a note alone is still recorded.
 */
function applyStatusOverride(
  ticket: Ticket,
  { status, note }: Pick<UpdateInput, "status" | "note">,
  { role, now }: ActionContext,
): { ticket: Ticket; notice: Notice | null } {
  if (!status || status === ticket.status) {
    return { ticket: note ? appendHistory(ticket, { status: ticket.status, at: now, note }) : ticket, notice: null };
  }
  const resolved = status === "Resolved";
  const changed: Ticket = {
    ...ticket,
    status,
    resolvedAt: resolved ? now : null,
    citizenConfirmation: resolved ? "pending" : null,
    resolution: resolved ? adminResolution(note, roleLabel(role), now) : null,
  };
  return {
    ticket: appendHistory(changed, { status, at: now, note: note || undefined }),
    notice: { subject: `Status changed to ${status}`, text: note || `Your issue is now ${status}.` },
  };
}

/**
 * The admin corrects the AI's category, department or priority. Changing the
 * category re-routes the department automatically unless the admin named one.
 */
function applyTriageOverrides(
  ticket: Ticket,
  { category, department, priority }: Pick<UpdateInput, "category" | "department" | "priority">,
): Ticket {
  const corrected = { ...ticket };
  if (category) {
    corrected.category = category;
    if (department === undefined) corrected.department = CATEGORY_DEPARTMENT[category];
  }
  if (department) corrected.department = department;
  if (priority) {
    corrected.basePriority = priority;
    corrected.priority = priority;
  }
  return corrected;
}

/** Which of the admin-editable fields an override actually changed, for the audit log. */
function changedTriageFields(before: Ticket, after: Ticket): string[] {
  const fields = ["status", "category", "department", "priority"] as const;
  return fields.filter((field) => before[field] !== after[field]);
}

/** Admin-only overrides: a human in the loop over the AI's decisions. */
export function updateTicket(ticket: Ticket, input: UpdateInput, context: ActionContext): ActionResult {
  if (!isAdminRole(context.role)) return failure(403, "Only the city admin can do this.");
  const { ticket: withStatus, notice } = applyStatusOverride(ticket, input, context);
  const withNote = input.note ? { ...withStatus, adminNotes: [...withStatus.adminNotes, input.note] } : withStatus;
  const updated = applyTriageOverrides(withNote, input);
  return done(updated, notice, {
    event: "ticket_updated",
    fields: { id: ticket.id, changed: changedTriageFields(ticket, updated) },
  });
}

/**
 * Route an action to its handler. Switching on the discriminant narrows `action`
 * to the exact input type each handler expects, and the `never` check makes a
 * new action without a handler a compile error.
 */
function dispatch(ticket: Ticket, action: TicketAction, context: ActionContext): ActionResult {
  switch (action.action) {
    case "review":
      return reviewTicket(ticket, action, context);
    case "acknowledge":
      return acknowledgeTicket(ticket, action, context);
    case "transfer":
      return transferTicket(ticket, action, context);
    case "note":
      return addTicketNote(ticket, action, context);
    case "update":
      return updateTicket(ticket, action, context);
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}

/**
 * Apply one staff action to a ticket and return the ticket ready to be saved.
 * Whatever the action, the safety rules are re-applied afterwards (nobody can
 * accidentally downgrade an open manhole below Critical), and any notice to
 * the reporters is also added to the ticket's conversation.
 */
export function applyTicketAction(ticket: Ticket, action: TicketAction, context: ActionContext): ActionResult {
  const current: Ticket = {
    ...ticket,
    updatedAt: context.now,
    history: [...(ticket.history ?? [])],
    messages: [...(ticket.messages ?? [])],
  };
  const result = dispatch(current, action, context);
  if (!result.ok) return result;
  const reprioritised = recomputePriority(result.ticket);
  const saved = result.notice
    ? appendMessage(reprioritised, systemMessage(result.notice.text, context.now))
    : reprioritised;
  return { ...result, ticket: saved };
}
