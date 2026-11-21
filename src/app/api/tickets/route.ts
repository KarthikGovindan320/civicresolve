// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT] /api/tickets: the end-to-end reporting pipeline
// -----------------------------------------------------------------------------
// POST is the heart of CivicResolve. In ONE request it:
//   1. validates the citizen's report (text, map location, photo, voice note)
//   2. asks Gemini to classify category, priority and department (gemini.ts)
//   3. applies non-negotiable safety rules (rules.ts)
//   4. checks for duplicates nearby and merges them (geo filter + Gemini)
//   5. routes the ticket to the responsible department's queue
//   6. returns the ticket plus a PRIVATE link that lets the citizen follow it,
//      talk to the department and confirm the fix, without creating an account.
// GET powers the public tracking dashboard and the staff dashboards.
// =============================================================================

import { NextResponse } from "next/server";
import { canActOn, staffRole } from "@/lib/auth";
import { classifyIssue, fallbackClassify, findDuplicate } from "@/lib/gemini";
import { log } from "@/lib/log";
import { baseUrl, notifyReporters } from "@/lib/notify";
import { normalizePhone, verifyOtp } from "@/lib/otp";
import { effectivePriority, haversine, recomputePriority, safetyRuleHit } from "@/lib/rules";
import { clientIp, rateLimit } from "@/lib/security";
import { store } from "@/lib/store";
import { CATEGORIES, CATEGORY_DEPARTMENT, isHeld, isPendingReview, type Category, type Ticket } from "@/lib/types";
import { parseEmail, readAudio, readImage } from "@/lib/uploads";
import { newReporter, privateLink, toPrivate, toPublic } from "@/lib/workflow";

// Duplicate search radius: about one city block. Wide enough to catch two people
// pinning the same pothole slightly differently, narrow enough to keep separate
// problems on the same road separate.
const DUP_RADIUS_M = 200;
// Reports without phone verification: at most this many per device per rate-limit window.
const UNVERIFIED_MAX = 3;

// BRIEF ✔ Issue Tracking Dashboard (data source). Newest first.
// [SECURITY] Role-aware output: the public gets public views only. Staff also
// get the conversation for tickets they're responsible for. Reporter
// identities (link secrets, emails) are never included for anyone.
export async function GET(req: Request) {
  const role = staffRole(req);
  const tickets = await store().list();
  tickets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // [SECURITY] Held (unverified / rejected) reports never reach the public or departments;
  // the city admin additionally sees the ones still waiting for review.
  const visible = tickets.filter((t) => !isHeld(t) || (role?.role === "admin" && isPendingReview(t)));
  const body = visible.map((t) => (canActOn(role, t) ? toPrivate(t) : toPublic(t)));
  // Live data: never let a CDN or browser serve a stale status.
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

// BRIEF ✔ Citizen Issue Reporting: title, description, location, category, optional image.
// BEYOND THE BRIEF: optional voice note in any language, optional email for updates.
export async function POST(req: Request) {
  // [SECURITY][EFFICIENCY] Rate limit per client IP before doing ANY work, so a
  // flood of requests can't exhaust the Gemini quota or fill the database.
  const limit = rateLimit(clientIp(req));
  if (!limit.ok) {
    log.warn("rate_limited");
    return NextResponse.json(
      { error: "Too many reports from this device. Please try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  // ---- 0. Phone verification (anti-spam accountability) ----
  // [SECURITY] Checked BEFORE any validation, AI or database work, so a script without
  // a verified phone number costs us almost nothing and never reaches Gemini or Firestore.
  // See lib/otp.ts for the stateless signed-challenge design.
  // Two buckets: a citizen who verifies goes straight to the department; one who sends
  // NO phone details is still heard, but the report is HELD for the city admin's review.
  // Sending phone details with a WRONG code is refused (never silently downgraded).
  const wantsVerify = Boolean(form.get("phone") || form.get("otp") || form.get("otpChallenge"));
  let phone: string | null = null;
  if (wantsVerify) {
    phone = normalizePhone(String(form.get("phone") ?? ""));
    if (!phone || !verifyOtp(phone, String(form.get("otp") ?? "").trim(), String(form.get("otpChallenge") ?? "")))
      return NextResponse.json({ error: "That code is incorrect or has expired." }, { status: 401 });
    // [SECURITY] Second rate-limit bucket per verified number: rotating IP addresses
    // doesn't help a spammer who has to keep using the same phone.
    if (!rateLimit(`phone:${phone}`).ok)
      return NextResponse.json({ error: "Too many reports from this phone number. Please try again later." }, { status: 429 });
  } else if (!rateLimit(`unverified:${clientIp(req)}`, Date.now(), UNVERIFIED_MAX).ok) {
    // [SECURITY] Unverified reports get a much tighter budget per device.
    return NextResponse.json(
      { error: "Too many unverified reports from this device. Verify your phone number to continue." },
      { status: 429 },
    );
  }
  const verified = phone !== null;

  // ---- 1. Input validation ----
  // [SECURITY] Every field is trimmed and length-capped server-side; the API
  // never trusts the browser. Errors come back as plain-language messages the
  // form shows as-is.
  const str = (k: string) => String(form.get(k) ?? "").trim();
  const title = str("title").slice(0, 120);
  const description = str("description").slice(0, 2000);
  const address = str("address").slice(0, 200);
  // Missing coordinates must be rejected, not silently coerced to 0,0
  // (Number("") === 0 would put the issue in the Atlantic Ocean).
  const lat = str("lat") ? Number(str("lat")) : NaN;
  const lng = str("lng") ? Number(str("lng")) : NaN;
  // The citizen's own category choice is accepted only if it is a known value.
  const userCategory = CATEGORIES.includes(str("category") as Category) ? (str("category") as Category) : null;
  const email = parseEmail(str("email"));
  if (email === "invalid") return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });

  // [SECURITY] Shared upload checks (size caps, real file type) from lib/uploads.ts.
  const img = await readImage(form.get("image"));
  if (!img.ok) return NextResponse.json({ error: img.error }, { status: img.status });
  const aud = await readAudio(form.get("audio"));
  if (!aud.ok) return NextResponse.json({ error: aud.error }, { status: aud.status });
  const image = img.part;
  const audio = aud.part;

  // [ACCESSIBILITY] A voice note alone is a valid report, so citizens who can't
  // type comfortably (or can't read English) are not excluded.
  if (!title && !description && !audio)
    return NextResponse.json({ error: "Add a title, a description or a voice note." }, { status: 400 });
  // Voice-only reports need Gemini to transcribe them, which is reserved for verified reporters.
  if (!verified && !title && !description)
    return NextResponse.json({ error: "Add a written title or description, or verify your phone to send a voice-only report." }, { status: 400 });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return NextResponse.json({ error: "Pick a location on the map." }, { status: 400 });

  // ---- 2. AI classification (Gemini, multimodal) ----
  // BRIEF ✔ AI-Powered Classification, Priority Detection, Department Recommendation.
  // [CODE QUALITY] classifyIssue never throws: on any AI failure it returns a
  // rule-based result with source = "fallback", so this endpoint always
  // succeeds for valid input.
  // [EFFICIENCY][SECURITY] Held (unverified) reports use the free rule-based classifier, so a
  // flood of anonymous submissions can never burn the Gemini quota.
  const { result: c, source, error: aiError } = verified
    ? await classifyIssue({ title, description, address, image, audio })
    : {
        result: {
          ...fallbackClassify({ title, description }),
          priorityReason: "Quick keyword-based guess (unverified reports are not sent to AI); confirmed on admin review.",
        },
        source: "fallback" as const,
        error: undefined,
      };
  // [GOOGLE SERVICES] Structured log → filterable in Cloud Logging (event="ai_fallback").
  if (aiError) log.warn("ai_fallback", { reason: aiError.slice(0, 300) });

  // AI decides the category; if AI was unavailable, respect the citizen's choice.
  const category = source === "fallback" && userCategory ? userCategory : c.category;
  const department = source === "fallback" ? CATEGORY_DEPARTMENT[category] : c.department;
  const db = store();
  const now = new Date().toISOString();
  const origin = baseUrl(req);
  // [SECURITY] This reporter's private link. The raw token is returned ONCE,
  // to the person who submitted; only a salt is stored (see workflow.ts).
  const { token, reporter } = newReporter(email, now, phone);

  // ---- 3. Duplicate detection: open tickets, same category, within 200 m ----
  // [EFFICIENCY] BEYOND THE BRIEF. Two-stage design: listOpen() pushes the
  // category/status filter down to the database (a Firestore query in
  // production), then cheap distance maths, then the expensive AI check only
  // on the 5 nearest candidates. Gemini calls stay bounded however many tickets exist.
  // Unverified reports are never merged into (or matched against) the live queues.
  const candidates = (verified ? await db.listOpen(category) : [])
    .filter((t) => !isHeld(t))
    .map((t) => ({ ...t, distance: haversine(t.location, { lat, lng }) }))
    .filter((t) => t.distance <= DUP_RADIUS_M)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
  const dup = await findDuplicate({ summary: c.englishSummary, category, image }, candidates);

  if (dup.id) {
    // Merge instead of discarding: the new reporter is counted (public impact),
    // gets their own private link to the SAME ticket, priority is recomputed,
    // the merge is logged on the public timeline with the AI's reason, and a
    // first photo is attached if the original had none.
    const existing = (await db.get(dup.id))!;
    const merged = recomputePriority({
      ...existing,
      reporterCount: existing.reporterCount + 1,
      reporters: [...(existing.reporters ?? []), reporter],
      updatedAt: now,
      hasImage: existing.hasImage || Boolean(image),
      history: [
        ...(existing.history ?? []),
        { status: existing.status, at: now, note: `Another citizen reported this (${dup.reason})` },
      ],
    });
    if (image && !existing.hasImage) await db.putImage(existing.id, image);
    await db.put(merged);
    log.info("ticket_merged", { id: merged.id, reporterCount: merged.reporterCount, aiSource: source });
    // The citizen is told their report joined an existing ticket, and given a
    // private link to it. No dead-end "duplicate rejected" message.
    return NextResponse.json({
      merged: true,
      reason: dup.reason,
      ticket: toPublic(merged),
      aiSource: source,
      privateLink: privateLink(origin, merged.id, token),
    });
  }

  // ---- 4. New ticket, routed to the department's queue ----
  // Safety rules run over the citizen's text, the English summary and the voice
  // transcript, so hazards are caught in any language.
  const hit = safetyRuleHit(`${title} ${description} ${c.englishSummary} ${c.transcript ?? ""}`);
  const { priority, note } = effectivePriority(c.priority, 1, hit);
  const id = await db.nextId();
  const ticket: Ticket = {
    id,
    // Voice-only reports still get a proper title and description from Gemini.
    title: title || c.title,
    description: description || c.transcript || c.englishSummary,
    originalLanguage: c.detectedLanguage,
    englishSummary: c.englishSummary,
    transcript: c.transcript,
    category,
    priority,
    basePriority: c.priority, // the AI's original call, kept for transparent recomputation
    // Explainability: if a rule changed the AI's priority, the reason says so.
    priorityReason: note ? `${note} ${c.priorityReason}` : c.priorityReason,
    department, // → appears in this department's queue immediately
    status: "Reported", // BRIEF ✔ lifecycle starts at "Reported"
    location: { lat, lng, address },
    reporterCount: 1,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    adminNotes: [],
    hasImage: Boolean(image),
    history: [
      verified
        ? { status: "Reported", at: now, note: `Routed to ${department}` }
        : { status: "Reported", at: now, note: `Held for review: sent without phone verification (suggested: ${department})` },
    ],
    verification: verified ? "phone" : "unverified",
    classifiedBy: source, // audit trail: staff see which tickets need a human check
    acknowledgedAt: null,
    expectedFixDate: null,
    transfers: 0,
    messages: [],
    reporters: [reporter],
    resolution: null,
    citizenConfirmation: null,
    reopenCount: 0,
  };
  // [EFFICIENCY] Images are stored separately so list queries stay small and fast.
  if (image) await db.putImage(id, image);
  await db.put(ticket);
  // [SECURITY][GOOGLE SERVICES] Logs only IDs and labels, never the citizen's
  // text, photo, email or location.
  log.info("ticket_created", { id, category, priority, department, aiSource: source, verified });
  await notifyReporters(
    ticket,
    "We received your report",
    verified
      ? `Thank you. Your report was classified as ${category} (${priority} priority) and sent to ${department}.`
      : `Thank you. Because it was sent without phone verification, a city officer will review it before it goes to ${department}.`,
    origin,
  );
  return NextResponse.json(
    {
      merged: false,
      unverified: !verified,
      ticket: toPublic(ticket),
      aiSource: source,
      userCategory,
      aiCategory: c.category,
      privateLink: privateLink(origin, id, token),
    },
    { status: 201 },
  );
}
