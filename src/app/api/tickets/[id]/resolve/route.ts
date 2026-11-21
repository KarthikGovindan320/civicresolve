// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT] POST /api/tickets/[id]/resolve: proof of fix
// -----------------------------------------------------------------------------
// A department can't just flip a ticket to "Resolved". It must upload an AFTER
// photo of the site. Gemini compares it with the citizen's BEFORE photo and the
// issue description and records a verdict (fixed / not_fixed / unclear) with a
// reason. The ticket then waits for the citizen to confirm or reopen it
// (./confirm); if they don't answer it auto-closes after AUTO_CLOSE_DAYS.
// That's the "resolution" half of the brief's "submission → tracking →
// resolution", with accountability built in.
// =============================================================================

import { NextResponse } from "next/server";
import { canActOn, roleLabel, staffRole } from "@/lib/auth";
import { verifyResolution } from "@/lib/gemini";
import { log } from "@/lib/log";
import { baseUrl, notifyReporters } from "@/lib/notify";
import { store } from "@/lib/store";
import { readImage } from "@/lib/uploads";
import { makeMessage, toPrivate } from "@/lib/workflow";

export async function POST(req: Request, ctx: RouteContext<"/api/tickets/[id]/resolve">) {
  // [SECURITY] Staff only, and only the department that owns the ticket (or the admin).
  const role = staffRole(req);
  if (!role) return NextResponse.json({ error: "Staff sign-in required." }, { status: 401 });
  const { id } = await ctx.params;
  const db = store();
  const t = await db.get(id);
  if (!t) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  if (!canActOn(role, t))
    return NextResponse.json({ error: "This ticket is assigned to another department." }, { status: 403 });
  if (t.status === "Resolved") return NextResponse.json({ error: "Already resolved." }, { status: 409 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  const note = String(form.get("note") ?? "").trim().slice(0, 500);
  const img = await readImage(form.get("photo"));
  if (!img.ok) return NextResponse.json({ error: img.error }, { status: img.status });
  // Proof is mandatory for departments; the city admin may close without a photo
  // (e.g. a duplicate or invalid report), which is recorded as such.
  if (!img.part && role.role !== "admin")
    return NextResponse.json({ error: "Upload an 'after' photo as proof of the fix." }, { status: 400 });
  if (!note) return NextResponse.json({ error: "Describe what was done." }, { status: 400 });

  // Gemini verification against the original evidence.
  const verdict = img.part
    ? await verifyResolution({
        summary: t.englishSummary,
        category: t.category,
        before: t.hasImage ? await db.getImage(t.id) : null,
        after: img.part,
      })
    : { verdict: "unclear" as const, reason: "Closed by the city admin without a photo." };

  const now = new Date().toISOString();
  const who = roleLabel(role);
  if (img.part) await db.putImage(`${t.id}-after`, img.part);
  const flag = verdict.verdict === "not_fixed" ? " ⚠ AI check: the photo may not show the issue fixed." : "";
  const text = `${who} reports this is fixed: ${note}${flag}`;
  const next = {
    ...t,
    status: "Resolved" as const,
    resolvedAt: now,
    updatedAt: now,
    citizenConfirmation: "pending" as const,
    resolution: { note, hasPhoto: Boolean(img.part), aiVerdict: verdict.verdict, aiReason: verdict.reason, by: who, at: now },
    history: [...(t.history ?? []), { status: "Resolved" as const, at: now, note: text }],
    messages: [
      ...(t.messages ?? []),
      makeMessage({ from: "system", text: `${text} Please confirm the fix or reopen the issue.`, lang: "en", translation: null }, now),
    ],
  };
  await db.put(next);
  log.info("ticket_resolved", { id: t.id, by: who, aiVerdict: verdict.verdict });
  await notifyReporters(
    next,
    "Your issue has been marked fixed: please confirm",
    `${text}\nIf it's not actually fixed, open your private link and press "Not fixed: reopen".`,
    baseUrl(req),
  );
  return NextResponse.json(toPrivate(next));
}
