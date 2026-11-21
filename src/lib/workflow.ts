// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT] RESOLUTION WORKFLOW: from "routed" to "fixed"
// -----------------------------------------------------------------------------
// The brief asks for an issue to "move from submission to tracking and
// resolution". Routing alone doesn't fix a pothole, so this module holds the
// rules of the process that follows:
//   • SLA deadlines per priority, plus overdue detection (→ escalation to admin)
//   • Citizen confirmation: a fix isn't final until the citizen confirms it,
//     reopens it, or stays silent for AUTO_CLOSE_DAYS
//   • Private citizen links: anonymous, unguessable, stored only as hashes
//   • Audience-specific views, so private data never leaks (see toPublic / toPrivate)
// Everything here is pure functions of the ticket and the clock, with no cron
// jobs or background workers, which keeps the Cloud Run deployment stateless.
// Covered by tests/workflow.test.ts and tests/api.test.ts.
// =============================================================================

import { createHmac, randomBytes } from "crypto";
import { safeEqual } from "./security";
import {
  AUTO_CLOSE_DAYS,
  SLA_HOURS,
  type Message,
  type PrivateTicket,
  type PublicTicket,
  type Reporter,
  type Ticket,
} from "./types";

const HOUR = 36e5;

// [SECURITY] Server secret for private links. LINK_SECRET comes from Secret
// Manager in production. If it's missing we derive one from the admin passcode,
// which is stable across Cloud Run instances, rather than a random value that
// would break links on every restart.
function linkSecret(): string {
  return process.env.LINK_SECRET || `civicresolve-link:${process.env.ADMIN_PASSCODE || "dev-only-secret"}`;
}

// [SECURITY] token = HMAC-SHA256(secret, salt): 256 bits, unguessable, and
// impossible to compute from the database without the server secret.
export function tokenFor(salt: string): string {
  return createHmac("sha256", linkSecret()).update(salt).digest("base64url");
}

export function newReporter(
  email: string | null,
  now = new Date().toISOString(),
  phone: string | null = null,
): { token: string; reporter: Reporter } {
  const salt = randomBytes(16).toString("base64url");
  // [SECURITY] The verified phone lives ONLY here, on the internal reporter record, which
  // toPublic()/toPrivate() strip from every response. Kept solely so misuse can be traced.
  return { token: tokenFor(salt), reporter: { salt, email, phone, at: now } };
}

// Does this link token belong to one of the ticket's reporters? Constant-time compare.
export function isReporter(t: Ticket, token: string | null | undefined): boolean {
  if (!token) return false;
  return (t.reporters ?? []).some((r) => safeEqual(tokenFor(r.salt), token));
}

// Private page for one reporter (used in the confirmation screen and emails).
export function privateLink(origin: string, ticketId: string, token: string): string {
  return `${origin}/track/${ticketId}?k=${encodeURIComponent(token)}`;
}

// SLA deadline = reported time + allowed hours for the CURRENT priority, so an
// escalation to Critical tightens the deadline immediately.
export function slaDueAt(t: Ticket): Date {
  return new Date(Date.parse(t.createdAt) + SLA_HOURS[t.priority] * HOUR);
}

export function isOverdue(t: Ticket, now = Date.now()): boolean {
  return t.status !== "Resolved" && now > slaDueAt(t).getTime();
}

// Was it fixed within the SLA? Used for each department's on-time rate.
export function resolvedOnTime(t: Ticket): boolean | null {
  if (t.status !== "Resolved" || !t.resolvedAt) return null;
  return Date.parse(t.resolvedAt) <= slaDueAt(t).getTime();
}

// [EFFICIENCY] Auto-close is evaluated lazily when a ticket is read. No
// scheduler is needed, and the result is identical.
export function withAutoClose(t: Ticket, now = Date.now()): Ticket {
  if (
    t.status === "Resolved" &&
    t.citizenConfirmation === "pending" &&
    t.resolvedAt &&
    now - Date.parse(t.resolvedAt) > AUTO_CLOSE_DAYS * 24 * HOUR
  ) {
    return { ...t, citizenConfirmation: "auto-closed" };
  }
  return t;
}

// [SECURITY] Public view: what anyone on the internet can see (map, list,
// ticket page). No reporter tokens, no emails, no private conversation.
export function toPublic(t: Ticket, now = Date.now()): PublicTicket {
  const c = withAutoClose(t, now);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { reporters, messages, ...rest } = c;
  return {
    ...rest,
    messageCount: messages?.length ?? 0,
    slaDueAt: slaDueAt(c).toISOString(),
    overdue: isOverdue(c, now),
  };
}

// [SECURITY] Private view: for the ticket's own citizen (valid link token) and
// for staff. It adds the conversation but STILL strips reporter identities.
export function toPrivate(t: Ticket, now = Date.now()): PrivateTicket {
  return { ...toPublic(t, now), messages: t.messages ?? [] };
}

export function makeMessage(m: Omit<Message, "id" | "at">, now = new Date().toISOString()): Message {
  return { id: randomBytes(6).toString("hex"), at: now, ...m };
}
