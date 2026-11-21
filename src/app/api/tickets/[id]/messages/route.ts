// =============================================================================
// POST /api/tickets/[id]/messages
// Department ↔ citizen conversation, anonymous and translated.
// -----------------------------------------------------------------------------
// Who can post:
//   • the citizen: proves ownership with their private link token (x-citizen-key)
//   • staff:       the department that owns the ticket, or the city admin
// Staff never learn the citizen's identity: there's no name or phone number,
// and the optional email is used only by the server to relay a notification.
// Gemini translates each message: staff replies go into the citizen's language,
// citizen replies into English.
// =============================================================================

import { NextResponse } from "next/server";
import { canActOn, isAdminRole, staffRole } from "@/lib/auth";
import { translateMessage } from "@/lib/gemini";
import { CITIZEN_KEY_HEADER, ERROR_MESSAGES, baseUrl, fail, readJsonBody } from "@/lib/http";
import { notifyReporters } from "@/lib/notify";
import { clientIp, rateLimit } from "@/lib/security";
import { store } from "@/lib/store";
import { LIMITS, type Message, type Role, type Ticket } from "@/lib/types";
import { appendMessage, isReporter, makeMessage, toPrivate } from "@/lib/workflow";

/** Officials read and write English. */
const STAFF_LANGUAGE = "en";

/** Who is posting: responsible staff (by role), otherwise a holder of the ticket's private link, otherwise nobody. */
function resolveAuthor(req: Request, ticket: Ticket, role: Role | null): Message["from"] | null {
  if (role && canActOn(role, ticket)) return isAdminRole(role) ? "admin" : "department";
  return isReporter(ticket, req.headers.get(CITIZEN_KEY_HEADER)) ? "citizen" : null;
}

/** Post a message to a ticket's private conversation, translated for the other side. */
export async function POST(req: Request, ctx: RouteContext<"/api/tickets/[id]/messages">) {
  const { id } = await ctx.params;
  const db = store();
  const ticket = await db.get(id);
  if (!ticket) return fail(404, ERROR_MESSAGES.ticketNotFound);

  const author = resolveAuthor(req, ticket, staffRole(req));
  if (!author) return fail(403, "Not allowed to message on this ticket.");

  // A separate rate-limit bucket for messages (each one may call Gemini).
  if (!rateLimit(`msg:${clientIp(req)}`).ok) return fail(429, "Too many messages. Please wait a few minutes.");

  const body = await readJsonBody(req);
  const text = typeof body.text === "string" ? body.text.trim().slice(0, LIMITS.message) : "";
  if (!text) return fail(400, "Message is empty.");

  // Staff write → translate into the citizen's language; citizen writes → English.
  const fromStaff = author !== "citizen";
  const targetLanguage = fromStaff ? ticket.originalLanguage || STAFF_LANGUAGE : STAFF_LANGUAGE;
  const { detectedLanguage, translation } = await translateMessage(text, targetLanguage);
  const now = new Date().toISOString();
  const message = makeMessage({ from: author, text, lang: detectedLanguage, translation }, now);
  // Appended to the latest stored version, so two messages sent at once are both kept.
  const updated = await db.update(ticket.id, (current) => appendMessage({ ...current, updatedAt: now }, message));
  if (!updated) return fail(404, ERROR_MESSAGES.ticketNotFound);
  if (fromStaff) {
    // Email relay: the citizen gets the message (and its translation) by email.
    const emailBody = translation ? `${text}\n\n${translation}` : text;
    await notifyReporters(updated, "New message about your issue", emailBody, baseUrl(req));
  }
  return NextResponse.json(toPrivate(updated));
}
