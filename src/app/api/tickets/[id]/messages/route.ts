// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT] POST /api/tickets/[id]/messages
// Department ↔ citizen conversation, anonymous and translated.
// -----------------------------------------------------------------------------
// Who can post:
//   • the citizen: proves ownership with their private link token (x-citizen-key)
//   • staff:       the department that owns the ticket, or the city admin
// [SECURITY] Staff never learn the citizen's identity: there's no name or phone
// number, and the optional email is used only by the server to relay a
// notification.
// [ACCESSIBILITY][GOOGLE SERVICES] Gemini translates each message: staff
// replies go into the citizen's language, citizen replies into English.
// =============================================================================

import { NextResponse } from "next/server";
import { canActOn, staffRole } from "@/lib/auth";
import { translateMessage } from "@/lib/gemini";
import { baseUrl, notifyReporters } from "@/lib/notify";
import { clientIp, rateLimit } from "@/lib/security";
import { store } from "@/lib/store";
import { isReporter, makeMessage, toPrivate } from "@/lib/workflow";

export async function POST(req: Request, ctx: RouteContext<"/api/tickets/[id]/messages">) {
  const { id } = await ctx.params;
  const db = store();
  const t = await db.get(id);
  if (!t) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });

  const role = staffRole(req);
  const citizen = isReporter(t, req.headers.get("x-citizen-key"));
  const staff = canActOn(role, t);
  if (!citizen && !staff) return NextResponse.json({ error: "Not allowed to message on this ticket." }, { status: 403 });

  // [SECURITY][EFFICIENCY] Separate rate-limit bucket for messages (each one may call Gemini).
  const limit = rateLimit(`msg:${clientIp(req)}`);
  if (!limit.ok) return NextResponse.json({ error: "Too many messages. Please wait a few minutes." }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 1000) : "";
  if (!text) return NextResponse.json({ error: "Message is empty." }, { status: 400 });

  // Staff write → translate into the citizen's language; citizen writes → English.
  const from = staff ? (role!.role === "admin" ? "admin" : "department") : "citizen";
  const target = staff ? t.originalLanguage || "en" : "en";
  const { detectedLanguage, translation } = await translateMessage(text, target);
  const now = new Date().toISOString();
  const next = {
    ...t,
    updatedAt: now,
    messages: [...(t.messages ?? []), makeMessage({ from, text, lang: detectedLanguage, translation }, now)],
  };
  await db.put(next);
  if (staff) {
    // Email relay: the citizen gets the message (and its translation) by email.
    await notifyReporters(next, "New message about your issue", translation ? `${text}\n\n${translation}` : text, baseUrl(req));
  }
  return NextResponse.json(toPrivate(next));
}
