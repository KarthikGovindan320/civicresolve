// =============================================================================
// /api/tickets: the end-to-end reporting pipeline
// -----------------------------------------------------------------------------
// POST is the heart of CivicResolve. In one request it:
//   1. checks the citizen's phone verification and validates the report
//      (text, map location, photo, voice note)
//   2. asks Gemini to classify category, priority and department
//   3. applies non-negotiable safety rules
//   4. checks for duplicates nearby and merges them (geo filter + Gemini)
//   5. routes the ticket to the responsible department's queue
//   6. returns the ticket plus a private link that lets the citizen follow it,
//      talk to the department and confirm the fix, without creating an account.
// The steps themselves live in lib/services/report.ts; this file orchestrates.
// GET powers the public tracking dashboard and the staff dashboards.
// =============================================================================

import { NextResponse } from "next/server";
import { canActOn, isAdminRole, staffRole } from "@/lib/auth";
import { ERROR_MESSAGES, NO_STORE_HEADERS, baseUrl, fail, failWith, readFormData } from "@/lib/http";
import { log } from "@/lib/log";
import { clientIp, rateLimit } from "@/lib/security";
import {
  classifyReport,
  createTicket,
  findDuplicateTicket,
  mergeIntoDuplicate,
  parseReportForm,
  verifyReporter,
} from "@/lib/services/report";
import { store } from "@/lib/store";
import { isHeld, isPendingReview } from "@/lib/types";
import { newReporter, privateLink, toPrivate, toPublic } from "@/lib/workflow";

/**
 * List tickets, newest first. The output is role-aware: the public gets public
 * views only; staff also get the conversation for tickets they are responsible
 * for. Reporter identities (link secrets, emails) are never included for anyone.
 */
export async function GET(req: Request) {
  const role = staffRole(req);
  const tickets = await store().list();
  tickets.sort((older, newer) => newer.createdAt.localeCompare(older.createdAt));
  // Held (unverified / rejected) reports never reach the public or departments;
  // the city admin additionally sees the ones still waiting for review.
  const visible = tickets.filter((ticket) => !isHeld(ticket) || (isAdminRole(role) && isPendingReview(ticket)));
  const body = visible.map((ticket) => (canActOn(role, ticket) ? toPrivate(ticket) : toPublic(ticket)));
  return NextResponse.json(body, { headers: NO_STORE_HEADERS });
}

/**
 * Submit a report: title, description, location, category and an optional
 * photo, plus an optional voice note in any language and an email for updates.
 */
export async function POST(req: Request) {
  // Rate limit per client IP before doing any work, so a flood of requests
  // can't exhaust the Gemini quota or fill the database.
  const ip = clientIp(req);
  const limit = rateLimit(ip);
  if (!limit.ok) {
    log.warn("rate_limited");
    return fail(429, "Too many reports from this device. Please try again in a few minutes.", {
      "Retry-After": String(limit.retryAfterSec),
    });
  }

  const form = await readFormData(req);
  if (!form) return fail(400, ERROR_MESSAGES.expectedFormData);

  const verification = verifyReporter(form, ip);
  if (!verification.ok) return failWith(verification);
  const { phone } = verification;
  const verified = phone !== null;

  const parsed = await parseReportForm(form, verified);
  if (!parsed.ok) return failWith(parsed);
  const { report } = parsed;

  const triage = await classifyReport(report, verified);
  const db = store();
  const now = new Date().toISOString();
  const origin = baseUrl(req);
  // This reporter's private link. The raw token is returned once, to the person
  // who submitted; only a salt is stored (see workflow.ts).
  const { token, reporter } = newReporter(report.email, now, phone);

  const duplicate = await findDuplicateTicket(db, report, triage, verified);
  if (duplicate) {
    const { reason } = duplicate;
    const merged = await mergeIntoDuplicate(db, duplicate.ticket, {
      reporter,
      reason,
      image: report.image,
      now,
      aiSource: triage.source,
    });
    return NextResponse.json({
      merged: true,
      reason,
      ticket: toPublic(merged),
      aiSource: triage.source,
      privateLink: privateLink(origin, merged.id, token),
    });
  }

  const ticket = await createTicket(db, { report, triage, reporter, verified, now }, origin);
  return NextResponse.json(
    {
      merged: false,
      unverified: !verified,
      ticket: toPublic(ticket),
      aiSource: triage.source,
      userCategory: report.userCategory,
      aiCategory: triage.classification.category,
      privateLink: privateLink(origin, ticket.id, token),
    },
    { status: 201 },
  );
}
