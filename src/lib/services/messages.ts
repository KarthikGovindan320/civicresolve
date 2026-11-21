// =============================================================================
// The department ↔ citizen conversation (the logic behind /messages)
// -----------------------------------------------------------------------------
// Who may post, which language a message is translated into, and how it joins
// the ticket. Staff never learn the citizen's identity: the citizen proves
// ownership only with their private-link token, and the optional email is used
// by the server alone to relay staff replies.
// Each rule is a function of (ticket, input) without database, network or
// logging; the route translates, saves and notifies.
// Covered by tests/messages.test.ts and tests/api.test.ts.
// =============================================================================
import { canActOn, isAdminRole } from "../auth";
import { failure, success, type Result } from "../result";
import type { Message, MessageAuthor, Role, Ticket } from "../types";
import { appendMessage, isReporter } from "../workflow";

/** Officials read and write English. */
export const STAFF_LANGUAGE = "en";
export const NOT_ALLOWED_TO_MESSAGE = "Not allowed to message on this ticket.";

/** What the caller showed: their staff role (if signed in) and the private-link token they sent (if any). */
export interface Poster {
  role: Role | null;
  citizenToken: string | null;
}

/** Who is posting: responsible staff (by role), otherwise a holder of the ticket's private link, otherwise nobody. */
export function messageAuthor(ticket: Ticket, { role, citizenToken }: Poster): MessageAuthor | null {
  if (canActOn(role, ticket)) return isAdminRole(role) ? "admin" : "department";
  return isReporter(ticket, citizenToken) ? "citizen" : null;
}

/** The language a message is translated into: staff replies into the citizen's language, citizen replies into English. */
export function translationTarget(ticket: Ticket, author: MessageAuthor): string {
  return author === "citizen" ? STAFF_LANGUAGE : ticket.originalLanguage || STAFF_LANGUAGE;
}

/**
 * Add a message to the latest stored ticket. The poster is checked again here,
 * because the ticket may have been transferred while the message was being
 * translated: a department that no longer owns it can't post to it.
 */
export function postMessage(current: Ticket, message: Message, poster: Poster): Result<{ ticket: Ticket }> {
  if (messageAuthor(current, poster) !== message.from) return failure(403, NOT_ALLOWED_TO_MESSAGE);
  return success({ ticket: appendMessage({ ...current, updatedAt: message.at }, message) });
}

/** The email relayed to the citizen for a staff message (with its translation), or null for the citizen's own. */
export function messageNotice(message: Message): { subject: string; text: string } | null {
  if (message.from === "citizen") return null;
  const text = message.translation ? `${message.text}\n\n${message.translation}` : message.text;
  return { subject: "New message about your issue", text };
}
