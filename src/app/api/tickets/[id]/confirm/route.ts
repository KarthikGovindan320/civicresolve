// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT] POST /api/tickets/[id]/confirm: the citizen closes the loop
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
import { log } from "@/lib/log";
import { clientIp, rateLimit } from "@/lib/security";
import { store } from "@/lib/store";
import { readImage } from "@/lib/uploads";
import { isReporter, makeMessage, toPrivate } from "@/lib/workflow";

export async function POST(req: Request, ctx: RouteContext<"/api/tickets/[id]/confirm">) {
  const { id } = await ctx.params;
  const db = store();
  const t = await db.get(id);
  if (!t) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  // [SECURITY] Only a reporter of this ticket can confirm or reopen it.
  if (!isReporter(t, req.headers.get("x-citizen-key")))
    return NextResponse.json({ error: "Use the private link you received when reporting." }, { status: 403 });
  if (!rateLimit(`confirm:${clientIp(req)}`).ok)
    return NextResponse.json({ error: "Too many requests. Please wait a few minutes." }, { status: 429 });
  if (t.status !== "Resolved")
    return NextResponse.json({ error: "This issue hasn't been marked fixed yet." }, { status: 409 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  const decision = String(form.get("decision") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 1000);
  const now = new Date().toISOString();

  if (decision === "confirm") {
    const next = {
      ...t,
      updatedAt: now,
      citizenConfirmation: "confirmed" as const,
      history: [...(t.history ?? []), { status: "Resolved" as const, at: now, note: "Citizen confirmed the fix ✔" }],
      messages: [...(t.messages ?? []), makeMessage({ from: "citizen", text: note || "Confirmed: it's fixed. Thank you!", lang: "en", translation: null }, now)],
    };
    await db.put(next);
    log.info("ticket_confirmed", { id });
    return NextResponse.json(toPrivate(next));
  }

  if (decision === "reopen") {
    if (!note) return NextResponse.json({ error: "Tell the department what is still wrong." }, { status: 400 });
    const img = await readImage(form.get("photo"));
    if (!img.ok) return NextResponse.json({ error: img.error }, { status: img.status });
    if (img.part) await db.putImage(`${t.id}-reopen`, img.part);
    const next = {
      ...t,
      status: "In Progress" as const,
      resolvedAt: null,
      updatedAt: now,
      citizenConfirmation: "reopened" as const,
      reopenCount: (t.reopenCount ?? 0) + 1,
      hasReopenPhoto: Boolean(img.part), // lets the department actually SEE the evidence (found in browser testing)
      history: [...(t.history ?? []), { status: "In Progress" as const, at: now, note: `Reopened by citizen: ${note}` }],
      messages: [...(t.messages ?? []), makeMessage({ from: "citizen", text: `Not fixed: ${note}`, lang: "en", translation: null }, now)],
    };
    await db.put(next);
    log.info("ticket_reopened", { id, reopenCount: next.reopenCount });
    return NextResponse.json(toPrivate(next));
  }

  return NextResponse.json({ error: "Decision must be 'confirm' or 'reopen'." }, { status: 400 });
}
