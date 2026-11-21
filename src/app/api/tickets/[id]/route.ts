// =============================================================================
// /api/tickets/[id]: read one ticket / manage it (department or admin)
// -----------------------------------------------------------------------------
// GET   → BRIEF ✔ citizens track a ticket by ID. With their private link token
//         (x-citizen-key header or ?k=) they also see the conversation.
// PATCH → BRIEF ✔ Admin Dashboard: "update statuses, and manage reported issues",
//         extended into a real department workflow:
//           action "acknowledge" → department accepts the ticket and commits to
//                                  a fix date (status → In Progress)
//           action "transfer"    → "not ours": hand it to the right department,
//                                  with a reason (visible on the public timeline)
//           action "note"        → add a public timeline note
//           action "update"      → admin only: override status / category /
//                                  department / priority (human-in-the-loop over the AI)
//         Resolving needs proof, so it has its own endpoint: ./resolve
// Every change notifies the reporters (in-app message + optional email).
// =============================================================================

import { NextResponse } from "next/server";
import { canActOn, roleLabel, staffRole } from "@/lib/auth";
import { log } from "@/lib/log";
import { baseUrl, notifyReporters } from "@/lib/notify";
import { recomputePriority } from "@/lib/rules";
import { store } from "@/lib/store";
import {
  CATEGORIES,
  CATEGORY_DEPARTMENT,
  DEPARTMENTS,
  PRIORITIES,
  STATUSES,
  fmtDay,
  isHeld,
  isPendingReview,
  type Department,
  type Ticket,
} from "@/lib/types";
import { isReporter, makeMessage, toPrivate, toPublic } from "@/lib/workflow";

export async function GET(req: Request, ctx: RouteContext<"/api/tickets/[id]">) {
  const { id } = await ctx.params;
  // Case-insensitive lookup: "cr-1004" typed on a phone still finds CR-1004.
  const t = await store().get(id.toUpperCase());
  if (!t) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  const token = req.headers.get("x-citizen-key") ?? new URL(req.url).searchParams.get("k");
  // [SECURITY] Private view only for this ticket's own reporters or responsible staff.
  const owner = isReporter(t, token);
  const role = staffRole(req);
  // [SECURITY] Held (unverified / rejected) reports exist only for their reporter and the admin.
  if (isHeld(t) && !owner && role?.role !== "admin")
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  const priv = owner || canActOn(role, t);
  return NextResponse.json(priv ? toPrivate(t) : toPublic(t), { headers: { "Cache-Control": "no-store" } });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(req: Request, ctx: RouteContext<"/api/tickets/[id]">) {
  // [SECURITY] Authentication and authorisation are enforced here on the server,
  // not just by hiding UI. A department can only act on its own tickets.
  const role = staffRole(req);
  if (!role) return NextResponse.json({ error: "Staff sign-in required." }, { status: 401 });
  const { id } = await ctx.params;
  const db = store();
  const t = await db.get(id);
  if (!t) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  if (!canActOn(role, t))
    return NextResponse.json({ error: "This ticket is assigned to another department." }, { status: 403 });

  // [SECURITY] Every field is whitelisted against the domain enums below: a
  // client cannot write arbitrary fields or values.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "update";
  const now = new Date().toISOString();
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  const who = roleLabel(role);
  let next: Ticket = { ...t, updatedAt: now, history: [...(t.history ?? [])], messages: [...(t.messages ?? [])] };
  let notice: { subject: string; text: string } | null = null;

  if (action === "review") {
    // [SECURITY][PROBLEM STATEMENT ALIGNMENT] The city admin screens reports that were sent
    // WITHOUT phone verification. Approve → it enters the department's normal queue.
    // Reject → it stays stored (for any later investigation) but is hidden everywhere.
    if (role.role !== "admin") return NextResponse.json({ error: "Only the city admin can review reports." }, { status: 403 });
    if (!isPendingReview(t)) return NextResponse.json({ error: "This report is not waiting for review." }, { status: 400 });
    const decision = body.decision;
    if (decision !== "approve" && decision !== "reject")
      return NextResponse.json({ error: "Decision must be 'approve' or 'reject'." }, { status: 400 });
    if (decision === "approve") {
      next.verification = "approved";
      const text = `Reviewed by the city admin and sent to ${t.department}.${note ? ` ${note}` : ""}`;
      next.history!.push({ status: t.status, at: now, note: text });
      notice = { subject: "Your report was accepted for action", text };
    } else {
      next.verification = "rejected";
      next.history!.push({ status: t.status, at: now, note: `Not accepted after review${note ? `: ${note}` : "."}` });
      notice = { subject: "Your report was not accepted", text: `After review, this report was not accepted.${note ? ` Reason: ${note}` : ""}` };
    }
    log.info("ticket_reviewed", { id, decision });
  } else if (action === "acknowledge") {
    // The department takes ownership and makes a public commitment.
    const fixBy = typeof body.expectedFixDate === "string" && ISO_DATE.test(body.expectedFixDate) ? body.expectedFixDate : null;
    next.status = "In Progress";
    next.acknowledgedAt = now;
    next.expectedFixDate = fixBy;
    next.resolvedAt = null;
    const text = `${who} accepted this issue${fixBy ? ` and expects to fix it by ${fmtDay(fixBy)}` : ""}.${note ? ` ${note}` : ""}`;
    next.history!.push({ status: "In Progress", at: now, note: text });
    notice = { subject: "Your issue is being worked on", text };
  } else if (action === "transfer") {
    // "Not our department": re-route with a mandatory reason, so hand-offs are
    // accountable and the citizen understands the delay.
    const to = body.department as Department;
    if (!DEPARTMENTS.includes(to) || to === t.department)
      return NextResponse.json({ error: "Choose a different, valid department." }, { status: 400 });
    if (!note) return NextResponse.json({ error: "Give a reason for the transfer." }, { status: 400 });
    next.department = to;
    next.transfers = (t.transfers ?? 0) + 1;
    next.status = "Reported"; // back in the new department's "to accept" queue
    next.acknowledgedAt = null;
    next.expectedFixDate = null;
    const text = `Transferred from ${t.department} to ${to}: ${note}`;
    next.history!.push({ status: "Reported", at: now, note: text });
    notice = { subject: "Your issue was passed to the right department", text };
    log.info("ticket_transferred", { id, from: t.department, to });
  } else if (action === "note") {
    if (!note) return NextResponse.json({ error: "Note is empty." }, { status: 400 });
    next.history!.push({ status: t.status, at: now, note: `${who}: ${note}` });
    next.adminNotes = [...t.adminNotes, note];
  } else if (action === "update") {
    // Admin-only overrides (human-in-the-loop over the AI's decisions).
    if (role.role !== "admin") return NextResponse.json({ error: "Only the city admin can do this." }, { status: 403 });
    // Status change: Reported → In Progress → Resolved. Each change is appended to
    // the public history (with the admin's note), and resolvedAt is stamped so the
    // dashboard can report average time-to-resolution.
    if (typeof body.status === "string" && STATUSES.includes(body.status as Ticket["status"]) && body.status !== t.status) {
      next.status = body.status as Ticket["status"];
      next.resolvedAt = next.status === "Resolved" ? now : null;
      if (next.status === "Resolved") {
        next.citizenConfirmation = "pending";
        next.resolution = { note: note || "Marked resolved by the city admin.", hasPhoto: false, aiVerdict: "unclear", aiReason: "No after-photo was provided.", by: who, at: now };
      }
      next.history!.push({ status: next.status, at: now, note: note || undefined });
      notice = { subject: `Status changed to ${next.status}`, text: note || `Your issue is now ${next.status}.` };
    } else if (note) {
      next.history!.push({ status: t.status, at: now, note });
    }
    if (note) next.adminNotes = [...t.adminNotes, note];
    // [PROBLEM STATEMENT ALIGNMENT] Human-in-the-loop: the admin can correct the
    // AI's category, department or priority. Changing the category re-routes
    // the department automatically unless the admin picked one explicitly.
    if (typeof body.category === "string" && CATEGORIES.includes(body.category as Ticket["category"])) {
      next.category = body.category as Ticket["category"];
      if (typeof body.department !== "string") next.department = CATEGORY_DEPARTMENT[next.category];
    }
    if (typeof body.department === "string" && DEPARTMENTS.includes(body.department as Department))
      next.department = body.department as Department;
    if (typeof body.priority === "string" && PRIORITIES.includes(body.priority as Ticket["priority"])) {
      next.basePriority = body.priority as Ticket["priority"];
      next.priority = next.basePriority;
    }
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  // [SECURITY] Safety rules still apply after manual edits: nobody can
  // accidentally downgrade an open manhole below Critical.
  next = recomputePriority(next);
  if (notice) next.messages!.push(makeMessage({ from: "system", text: notice.text, lang: "en", translation: null }, now));
  await db.put(next);
  if (notice) await notifyReporters(next, notice.subject, notice.text, baseUrl(req));
  return NextResponse.json(toPrivate(next));
}
