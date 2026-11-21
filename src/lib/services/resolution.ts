// =============================================================================
// Closing the loop on a fix (the logic behind /resolve and /confirm)
// -----------------------------------------------------------------------------
//   resolve → staff report a fix with a note and an "after" photo, which Gemini
//             checks against the citizen's report (the city admin may close
//             without a photo); the ticket then waits for the citizen
//   confirm → the citizen agrees it is fixed, or reopens it with a reason and
//             an optional new photo, sending it back to the department
// Like ticket-actions.ts, every rule is a function of (ticket, input) that
// returns the updated ticket or the error to answer with, so the routes only
// parse, authorise, persist and respond. The one exception is assessFix(),
// which reads the original photo and asks Gemini; it is kept here so the
// route never decides what a verdict means.
// Covered by tests/resolution.test.ts and tests/api.test.ts.
// =============================================================================
import "server-only";
import { canActOn, isAdminRole } from "../auth";
import { verifyResolution, type MediaPart } from "../gemini";
import { ERROR_MESSAGES } from "../http";
import { photoKey } from "../photos";
import { failure, success, type Failure, type Result } from "../result";
import type { Store } from "../store";
import { isOneOf, type Resolution, type Role, type Ticket } from "../types";
import { appendHistory, appendMessage, makeMessage, resolutionWithoutPhoto, systemMessage } from "../workflow";

export const ALREADY_RESOLVED = "Already resolved.";
export const NOT_RESOLVED_YET = "This issue hasn't been marked fixed yet.";
const NOT_FIXED_WARNING = " ⚠ AI check: the photo may not show the issue fixed.";

/** What a citizen can answer to a reported fix. */
export const CITIZEN_DECISIONS = ["confirm", "reopen"] as const;
export type CitizenDecision = (typeof CITIZEN_DECISIONS)[number];

type TicketResult = Result<{ ticket: Ticket }>;

// ---- Staff report a fix -----------------------------------------------------

/** Why `role` may not resolve this ticket (403, or 409 when it is already resolved), or null when it may. */
export function resolveProblem(role: Role, ticket: Ticket): Failure | null {
  if (!canActOn(role, ticket)) return failure(403, ERROR_MESSAGES.otherDepartment);
  if (ticket.status === "Resolved") return failure(409, ALREADY_RESOLVED);
  return null;
}

/** Why a proof of fix is not acceptable, or null when it is. Departments must send a photo; the admin need not. */
export function proofProblem(role: Role, proof: { note: string; hasPhoto: boolean }): Failure | null {
  if (!proof.hasPhoto && !isAdminRole(role)) return failure(400, "Upload an 'after' photo as proof of the fix.");
  if (!proof.note) return failure(400, "Describe what was done.");
  return null;
}

/**
 * The proof-of-fix record. With an after-photo, Gemini compares it with the
 * citizen's original photo (when there is one) and the issue summary; without
 * one (an admin closing a duplicate or invalid report) nothing is checked.
 */
export async function assessFix(
  db: Store,
  ticket: Ticket,
  fix: { note: string; afterPhoto: MediaPart | null; by: string; at: string },
): Promise<Resolution> {
  const { note, afterPhoto, by, at } = fix;
  if (!afterPhoto) return resolutionWithoutPhoto({ note, by, at });
  const { verdict, reason } = await verifyResolution({
    summary: ticket.englishSummary,
    category: ticket.category,
    before: ticket.hasImage ? await db.getImage(photoKey(ticket.id, "before")) : null,
    after: afterPhoto,
  });
  return { note, hasPhoto: true, aiVerdict: verdict, aiReason: reason, by, at };
}

/** The public line announcing a fix, flagged when the AI doubts the photo shows it. */
export function fixSummary(resolution: Resolution): string {
  const warning = resolution.aiVerdict === "not_fixed" ? NOT_FIXED_WARNING : "";
  return `${resolution.by} reports this is fixed: ${resolution.note}${warning}`;
}

/**
 * Close the latest stored ticket as fixed: proof recorded, public timeline
 * updated, citizen asked to confirm. Permission and status are checked again
 * here, because the ticket may have been resolved or transferred while Gemini
 * was checking the photo.
 */
export function resolveTicket(current: Ticket, role: Role, resolution: Resolution): TicketResult {
  const problem = resolveProblem(role, current);
  if (problem) return problem;
  const { at: now } = resolution;
  const summary = fixSummary(resolution);
  const resolved = appendHistory(
    { ...current, status: "Resolved", resolvedAt: now, updatedAt: now, citizenConfirmation: "pending", resolution },
    { status: "Resolved", at: now, note: summary },
  );
  return success({
    ticket: appendMessage(resolved, systemMessage(`${summary} Please confirm the fix or reopen the issue.`, now)),
  });
}

// ---- The citizen answers ----------------------------------------------------

/** A citizen's validated answer to a reported fix. */
export interface CitizenAnswer {
  decision: CitizenDecision;
  note: string;
}

const awaitingAnswer = (ticket: Ticket): Failure | null =>
  ticket.status === "Resolved" ? null : failure(409, NOT_RESOLVED_YET);

/**
 * Validate a citizen's answer before anything is stored: the ticket must be
 * awaiting one (409), the decision must be known, and reopening needs a reason.
 */
export function parseCitizenAnswer(ticket: Ticket, decision: string, note: string): Result<CitizenAnswer> {
  const notAwaiting = awaitingAnswer(ticket);
  if (notAwaiting) return notAwaiting;
  if (!isOneOf(CITIZEN_DECISIONS, decision)) return failure(400, "Decision must be 'confirm' or 'reopen'.");
  if (decision === "reopen" && !note) return failure(400, "Tell the department what is still wrong.");
  return success({ decision, note });
}

const citizenMessage = (text: string, now: string) =>
  makeMessage({ from: "citizen", text, lang: "en", translation: null }, now);

/** The ticket after the citizen agrees it is fixed. */
function confirmed(ticket: Ticket, note: string, now: string): Ticket {
  return appendMessage(
    appendHistory(
      { ...ticket, updatedAt: now, citizenConfirmation: "confirmed" },
      { status: "Resolved", at: now, note: "Citizen confirmed the fix ✔" },
    ),
    citizenMessage(note || "Confirmed: it's fixed. Thank you!", now),
  );
}

/** The ticket after the citizen says it is not fixed: back to the department as In Progress. */
function reopened(ticket: Ticket, note: string, hasPhoto: boolean, now: string): Ticket {
  const backInProgress: Ticket = {
    ...ticket,
    status: "In Progress",
    resolvedAt: null,
    updatedAt: now,
    citizenConfirmation: "reopened",
    reopenCount: (ticket.reopenCount ?? 0) + 1,
    hasReopenPhoto: hasPhoto, // lets the department see the citizen's evidence
  };
  return appendMessage(
    appendHistory(backInProgress, { status: "In Progress", at: now, note: `Reopened by citizen: ${note}` }),
    citizenMessage(`Not fixed: ${note}`, now),
  );
}

/** Apply the citizen's answer to the latest stored ticket, only while it is still awaiting one. */
export function applyCitizenAnswer(
  current: Ticket,
  answer: CitizenAnswer & { hasPhoto: boolean; now: string },
): TicketResult {
  const notAwaiting = awaitingAnswer(current);
  if (notAwaiting) return notAwaiting;
  const { decision, note, hasPhoto, now } = answer;
  return success({
    ticket: decision === "confirm" ? confirmed(current, note, now) : reopened(current, note, hasPhoto, now),
  });
}
