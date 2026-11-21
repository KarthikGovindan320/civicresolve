// =============================================================================
// Resolution workflow: from "routed" to "fixed"
// -----------------------------------------------------------------------------
// The brief asks for an issue to "move from submission to tracking and
// resolution". Routing alone doesn't fix a pothole, so this module holds the
// rules of the process that follows:
//   • SLA deadlines per priority, plus overdue detection (→ escalation to admin)
//   • Citizen confirmation: a fix isn't final until the citizen confirms it,
//     reopens it, or stays silent for AUTO_CLOSE_DAYS
//   • Private citizen links: anonymous, unguessable, stored only as salts
//   • Audience-specific views, so private data never leaks (see toPublic / toPrivate)
// Deadlines, auto-close and views are worked out from the ticket and the clock
// when a ticket is read, with no cron jobs or background workers, which keeps
// the Cloud Run deployment stateless. This module does no database or network
// I/O; link tokens and photo signatures are HMACs keyed by the server secret
// (secrets.ts), and new salts and message ids come from crypto.randomBytes.
// Covered by tests/workflow.test.ts and tests/api.test.ts.
// =============================================================================

import { createHmac, randomBytes } from "crypto";
import { DAY_MS, HOUR_MS } from "./constants";
import { photoPath, type PhotoVariant } from "./photos";
import { signingSecret } from "./secrets";
import { safeEqual } from "./security";
import {
  AUTO_CLOSE_DAYS,
  isHeld,
  SLA_HOURS,
  type HistoryEntry,
  type Message,
  type PrivateTicket,
  type PublicTicket,
  type Reporter,
  type Resolution,
  type Ticket,
} from "./types";

const REPORTER_SALT_BYTES = 16;
const MESSAGE_ID_BYTES = 6;

// Server secret for private links and photo signatures: LINK_SECRET, from
// Secret Manager in production. It must be stable across Cloud Run instances
// and restarts, or every link already sent would stop working; when it is
// missing in production, signing refuses to run (see secrets.ts).
const linkSecret = () => signingSecret("LINK_SECRET");

/**
 * The private-link token for a reporter salt: HMAC-SHA256(secret, salt). 256
 * bits, unguessable, and impossible to compute from the database without the
 * server secret.
 */
export function tokenFor(salt: string): string {
  return createHmac("sha256", linkSecret()).update(salt).digest("base64url");
}

/**
 * Signature that unlocks the photos of a ticket held for review (reports sent without phone
 * verification). Security: ticket ids are sequential, so without this anyone could walk
 * CR-1001, CR-1002, … and download photos from reports that are deliberately hidden from the
 * public. The signature is HMAC-SHA256(server secret, "photo|id|variant"): it can only be produced
 * by the server, it is bound to one ticket and one photo, and the server hands it out only on
 * pages the viewer is already allowed to see (the reporter's private page).
 */
export function photoSignature(ticketId: string, variant: PhotoVariant): string {
  return createHmac("sha256", linkSecret()).update(`photo|${ticketId}|${variant}`).digest("base64url").slice(0, 32);
}

/**
 * URL of one of a ticket's photos. Public tickets get a plain URL; held tickets get a signed one
 * (see photoSignature), so their photos stay private even though the id is guessable.
 */
export function photoUrl(ticket: Pick<Ticket, "id" | "verification">, variant: PhotoVariant, version?: string): string {
  const path = photoPath(ticket.id, variant, version);
  // The signature is base64url, so it needs no further encoding in the query string.
  return isHeld(ticket) ? `${path}&s=${photoSignature(ticket.id, variant)}` : path;
}

/** Create a reporter record and the private-link token that goes (once) to the person who submitted. */
export function newReporter(
  email: string | null,
  now = new Date().toISOString(),
  phone: string | null = null,
): { token: string; reporter: Reporter } {
  const salt = randomBytes(REPORTER_SALT_BYTES).toString("base64url");
  // The verified phone lives only here, on the internal reporter record, which
  // toPublic()/toPrivate() strip from every response. Kept solely so misuse can be traced.
  return { token: tokenFor(salt), reporter: { salt, email, phone, at: now } };
}

/** Does this link token belong to one of the ticket's reporters? Constant-time compare. */
export function isReporter(ticket: Ticket, token: string | null | undefined): boolean {
  if (!token) return false;
  return (ticket.reporters ?? []).some((reporter) => safeEqual(tokenFor(reporter.salt), token));
}

/** URL of one reporter's private page (used on the confirmation screen and in emails). */
export function privateLink(origin: string, ticketId: string, token: string): string {
  return `${origin}/track/${ticketId}?k=${encodeURIComponent(token)}`;
}

/**
 * SLA deadline: reported time plus the hours allowed for the current priority,
 * so an escalation to Critical tightens the deadline immediately.
 */
export function slaDueAt(ticket: Ticket): Date {
  return new Date(Date.parse(ticket.createdAt) + SLA_HOURS[ticket.priority] * HOUR_MS);
}

/** Whether an unresolved ticket has passed its SLA deadline. */
export function isOverdue(ticket: Ticket, now = Date.now()): boolean {
  return ticket.status !== "Resolved" && now > slaDueAt(ticket).getTime();
}

/**
 * Mark a fix the citizen never answered as auto-closed. Evaluated lazily when a
 * ticket is read, so no scheduler is needed and the result is identical.
 */
export function withAutoClose(ticket: Ticket, now = Date.now()): Ticket {
  if (
    ticket.status === "Resolved" &&
    ticket.citizenConfirmation === "pending" &&
    ticket.resolvedAt &&
    now - Date.parse(ticket.resolvedAt) > AUTO_CLOSE_DAYS * DAY_MS
  ) {
    return { ...ticket, citizenConfirmation: "auto-closed" };
  }
  return ticket;
}

/**
 * Public view: what anyone on the internet can see (map, list, ticket page).
 * No reporter tokens, no emails, no private conversation.
 */
export function toPublic(ticket: Ticket, now = Date.now()): PublicTicket {
  const current = withAutoClose(ticket, now);
  // Reporter records (link salts, emails, phone numbers) are dropped here and never leave the server.
  const { reporters: _reporters, messages, ...publicFields } = current;
  return {
    ...publicFields,
    messageCount: messages?.length ?? 0,
    slaDueAt: slaDueAt(current).toISOString(),
    overdue: isOverdue(current, now),
  };
}

/**
 * Private view: for the ticket's own citizen (valid link token) and for staff.
 * It adds the conversation but still strips reporter identities.
 */
export function toPrivate(ticket: Ticket, now = Date.now()): PrivateTicket {
  return { ...toPublic(ticket, now), messages: ticket.messages ?? [] };
}

/** Build a conversation message with a fresh id and timestamp. */
export function makeMessage(message: Omit<Message, "id" | "at">, now = new Date().toISOString()): Message {
  return { id: randomBytes(MESSAGE_ID_BYTES).toString("hex"), at: now, ...message };
}

/** A system-authored English message, used for workflow updates in the conversation. */
export function systemMessage(text: string, now?: string): Message {
  return makeMessage({ from: "system", text, lang: "en", translation: null }, now);
}

/** A copy of the ticket with one more entry on its public timeline. */
export function appendHistory<T extends Ticket>(ticket: T, entry: HistoryEntry): T {
  return { ...ticket, history: [...(ticket.history ?? []), entry] };
}

/** A copy of the ticket with one more message in its private conversation. */
export function appendMessage<T extends Ticket>(ticket: T, message: Message): T {
  return { ...ticket, messages: [...(ticket.messages ?? []), message] };
}

/**
 * The proof-of-fix record for a ticket closed without an after-photo: by the
 * city admin (a status override, or closing a duplicate or invalid report), or
 * a demo ticket fixed before photo checks existed. Nothing could be checked, so
 * the AI verdict is "unclear" and the citizen still confirms or reopens.
 */
export function resolutionWithoutPhoto({ note, by, at }: Pick<Resolution, "note" | "by" | "at">): Resolution {
  return { note, hasPhoto: false, aiVerdict: "unclear", aiReason: "No after-photo was provided.", by, at };
}
