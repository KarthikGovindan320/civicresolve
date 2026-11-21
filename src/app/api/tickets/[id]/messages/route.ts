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
// citizen replies into English. The rules live in lib/services/messages.ts.
// =============================================================================

import { NextResponse } from "next/server";
import { authenticateStaff } from "@/lib/auth";
import { translateMessage } from "@/lib/gemini";
import { CITIZEN_KEY_HEADER } from "@/lib/headers";
import {
  ERROR_MESSAGES,
  baseUrl,
  fail,
  failWith,
  findTicket,
  readJsonBody,
  spendBudget,
  updateTicketAtomically,
} from "@/lib/http";
import { notifyReporters } from "@/lib/notify";
import { MessageBodySchema } from "@/lib/schemas";
import {
  NOT_ALLOWED_TO_MESSAGE,
  messageAuthor,
  messageNotice,
  postMessage,
  translationTarget,
} from "@/lib/services/messages";
import { store } from "@/lib/store";
import { makeMessage, toPrivate } from "@/lib/workflow";

/** Each message may call Gemini to translate it, so messages have their own budget. */
const MESSAGE_BUDGET = { bucket: "msg", message: "Too many messages. Please wait a few minutes." };

/** Post a message to a ticket's private conversation, translated for the other side. */
export async function POST(req: Request, ctx: RouteContext<"/api/tickets/[id]/messages">) {
  const overBudget = spendBudget(req, MESSAGE_BUDGET);
  if (overBudget) return failWith(overBudget);
  const staff = authenticateStaff(req);
  if (!staff.ok) return failWith(staff);
  const body = await readJsonBody(req, MessageBodySchema);
  if (!body?.text) return fail(400, "Message is empty.");

  const { id } = await ctx.params;
  const db = store();
  const ticket = await findTicket(db, id);
  if (!ticket) return fail(404, ERROR_MESSAGES.ticketNotFound);
  const poster = { role: staff.role, citizenToken: req.headers.get(CITIZEN_KEY_HEADER) };
  const author = messageAuthor(ticket, poster);
  if (!author) return fail(403, NOT_ALLOWED_TO_MESSAGE);
  const origin = baseUrl(req);

  const { detectedLanguage, translation } = await translateMessage(body.text, translationTarget(ticket, author));
  const message = makeMessage({ from: author, text: body.text, lang: detectedLanguage, translation });
  // Appended to the latest stored version, so two messages sent at once are both kept.
  const result = await updateTicketAtomically(db, ticket.id, (current) => postMessage(current, message, poster));
  if (!result.ok) return failWith(result);
  // Email relay: the citizen gets a staff message (and its translation) by email.
  const notice = messageNotice(message);
  if (notice) await notifyReporters(result.ticket, notice.subject, notice.text, origin);
  return NextResponse.json(toPrivate(result.ticket));
}
