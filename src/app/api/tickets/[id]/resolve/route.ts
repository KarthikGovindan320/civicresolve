// =============================================================================
// POST /api/tickets/[id]/resolve: proof of fix
// -----------------------------------------------------------------------------
// A department can't just flip a ticket to "Resolved". It must upload an "after"
// photo of the site. Gemini compares it with the citizen's "before" photo and the
// issue description and records a verdict (fixed / not_fixed / unclear) with a
// reason. The ticket then waits for the citizen to confirm or reopen it
// (./confirm); if they don't answer it auto-closes after AUTO_CLOSE_DAYS.
// That's the "resolution" half of the brief's "submission → tracking →
// resolution", with accountability built in.
// =============================================================================

import { NextResponse } from "next/server";
import { isAdminRole, roleLabel } from "@/lib/auth";
import { verifyResolution, type MediaPart } from "@/lib/gemini";
import { ERROR_MESSAGES, baseUrl, fail, failWith, formText, loadTicketForStaff, readFormData } from "@/lib/http";
import { log } from "@/lib/log";
import { notifyReporters } from "@/lib/notify";
import type { Store } from "@/lib/store";
import { LIMITS, type Resolution, type Ticket } from "@/lib/types";
import { readImage } from "@/lib/uploads";
import { appendHistory, appendMessage, systemMessage, toPrivate } from "@/lib/workflow";

/** Image-store key suffix for the department's proof-of-fix photo. */
const AFTER_PHOTO_SUFFIX = "-after";
const NOT_FIXED_WARNING = " ⚠ AI check: the photo may not show the issue fixed.";

type Verdict = { verdict: Resolution["aiVerdict"]; reason: string };

/** Ask Gemini whether the after-photo shows the fix; without a photo there is nothing to check. */
async function checkFix(db: Store, ticket: Ticket, afterPhoto: MediaPart | null): Promise<Verdict> {
  if (!afterPhoto) return { verdict: "unclear", reason: "Closed by the city admin without a photo." };
  return verifyResolution({
    summary: ticket.englishSummary,
    category: ticket.category,
    before: ticket.hasImage ? await db.getImage(ticket.id) : null,
    after: afterPhoto,
  });
}

/** Mark a ticket fixed, with a note and an after-photo that Gemini checks against the original report. */
export async function POST(req: Request, ctx: RouteContext<"/api/tickets/[id]/resolve">) {
  const { id } = await ctx.params;
  // Staff only, and only the department that owns the ticket (or the admin).
  const access = await loadTicketForStaff(req, id);
  if (!access.ok) return failWith(access);
  const { ticket, role, db } = access;
  if (ticket.status === "Resolved") return fail(409, "Already resolved.");

  const form = await readFormData(req);
  if (!form) return fail(400, ERROR_MESSAGES.expectedFormData);
  const note = formText(form, "note", LIMITS.staffNote);
  const photo = await readImage(form.get("photo"));
  if (!photo.ok) return failWith(photo);
  const afterPhoto = photo.part;
  // Proof is mandatory for departments; the city admin may close without a photo
  // (e.g. a duplicate or invalid report), which is recorded as such.
  if (!afterPhoto && !isAdminRole(role)) return fail(400, "Upload an 'after' photo as proof of the fix.");
  if (!note) return fail(400, "Describe what was done.");

  const { verdict, reason } = await checkFix(db, ticket, afterPhoto);
  const now = new Date().toISOString();
  const resolvedBy = roleLabel(role);
  if (afterPhoto) await db.putImage(`${ticket.id}${AFTER_PHOTO_SUFFIX}`, afterPhoto);

  const summary = `${resolvedBy} reports this is fixed: ${note}${verdict === "not_fixed" ? NOT_FIXED_WARNING : ""}`;
  const resolved: Ticket = appendMessage(
    appendHistory(
      {
        ...ticket,
        status: "Resolved",
        resolvedAt: now,
        updatedAt: now,
        citizenConfirmation: "pending",
        resolution: {
          note,
          hasPhoto: Boolean(afterPhoto),
          aiVerdict: verdict,
          aiReason: reason,
          by: resolvedBy,
          at: now,
        },
      },
      { status: "Resolved", at: now, note: summary },
    ),
    systemMessage(`${summary} Please confirm the fix or reopen the issue.`, now),
  );
  await db.put(resolved);
  log.info("ticket_resolved", { id: ticket.id, by: resolvedBy, aiVerdict: verdict });
  await notifyReporters(
    resolved,
    "Your issue has been marked fixed: please confirm",
    `${summary}\nIf it's not actually fixed, open your private link and press "Not fixed: reopen".`,
    baseUrl(req),
  );
  return NextResponse.json(toPrivate(resolved));
}
