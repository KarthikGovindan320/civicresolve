// =============================================================================
// The reporting pipeline (the logic behind POST /api/tickets)
// -----------------------------------------------------------------------------
// One citizen report passes through these steps, each a small function here:
//   1. verifyReporter        → phone verification and the anti-spam budgets
//   2. parseReportForm       → validate text, location, photo and voice note
//   3. classifyReport        → Gemini (or keyword rules) picks category,
//                              priority and department
//   4. findDuplicateTicket   → is this the same problem as a nearby open ticket?
//   5. mergeIntoDuplicate or createTicket → save, log and notify
// The pure parts (validation, candidate selection, building and merging
// tickets) are exported separately and covered by tests/report.test.ts.
// =============================================================================
import "server-only";
import { classifyIssue, fallbackClassify, findDuplicate, type MediaPart } from "../gemini";
import { formText } from "../http";
import { log } from "../log";
import { notifyReporters } from "../notify";
import { normalizePhone, verifyOtp } from "../otp";
import { failure, rateLimited, type Failure, type Result } from "../result";
import { effectivePriority, haversine, recomputePriority, safetyRuleHit, safetyScanText } from "../rules";
import { rateLimit } from "../security";
import type { Store } from "../store";
import {
  CATEGORIES,
  CATEGORY_DEPARTMENT,
  LIMITS,
  isHeld,
  isOneOf,
  type Category,
  type Classification,
  type Department,
  type Reporter,
  type Ticket,
} from "../types";
import { readAudio, readImage } from "../uploads";
import { appendHistory } from "../workflow";

/**
 * Duplicate search radius: about one city block. Wide enough to catch two people
 * pinning the same pothole slightly differently, narrow enough to keep separate
 * problems on the same road separate.
 */
export const DUPLICATE_RADIUS_M = 200;
/** Only this many of the nearest candidates go to the AI check, so Gemini usage stays bounded. */
export const MAX_DUPLICATE_CANDIDATES = 5;
/** Reports without phone verification: at most this many per device per rate-limit window. */
export const MAX_UNVERIFIED_REPORTS = 3;
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UNVERIFIED_PRIORITY_REASON =
  "Quick keyword-based guess (unverified reports are not sent to AI); confirmed on admin review.";

/** A validated citizen report, before classification. */
export interface ReportInput {
  title: string;
  description: string;
  address: string;
  lat: number;
  lng: number;
  /** The citizen's own category choice, if it was a known value. */
  userCategory: Category | null;
  email: string | null;
  image: MediaPart | null;
  audio: MediaPart | null;
}

/** The outcome of classification, after reconciling the AI's answer with the citizen's choice. */
export interface Triage {
  classification: Classification;
  /** "gemini" when the AI answered, "fallback" when keyword rules were used. */
  source: "gemini" | "fallback";
  category: Category;
  department: Department;
}

// ---- 1. Phone verification --------------------------------------------------

/**
 * Check the reporter's phone verification, before any validation, AI or database
 * work, so a script without a verified number costs almost nothing (see otp.ts).
 * There are two buckets: a citizen who verifies goes straight to the department
 * (`phone` is their number); one who sends no phone details is still heard
 * (`phone` is null) but the report is held for the city admin's review. Phone
 * details with a wrong code are refused, never silently downgraded.
 */
export function verifyReporter(form: FormData, ip: string): Result<{ phone: string | null }> {
  const [rawPhone, code, challenge] = [formText(form, "phone"), formText(form, "otp"), formText(form, "otpChallenge")];
  if (!rawPhone && !code && !challenge) {
    // Unverified reports get a much tighter budget per device.
    const limit = rateLimit(`unverified:${ip}`, { max: MAX_UNVERIFIED_REPORTS });
    if (!limit.ok)
      return rateLimited(
        "Too many unverified reports from this device. Verify your phone number to continue.",
        limit.retryAfterSec,
      );
    return { ok: true, phone: null };
  }
  const phone = normalizePhone(rawPhone);
  if (!phone || !verifyOtp(phone, code, challenge)) return failure(401, "That code is incorrect or has expired.");
  // A second budget per verified number: rotating IP addresses doesn't help a
  // spammer who has to keep using the same phone.
  const limit = rateLimit(`phone:${phone}`);
  if (!limit.ok)
    return rateLimited("Too many reports from this phone number. Please try again later.", limit.retryAfterSec);
  return { ok: true, phone };
}

// ---- 2. Input validation ----------------------------------------------------

/**
 * Parse a coordinate field. Blank input is NaN, not 0: Number("") === 0 would
 * silently put the issue in the Atlantic Ocean.
 */
export function parseCoordinate(raw: string): number {
  return raw ? Number(raw) : NaN;
}

/** Whether the pair is a real point on Earth. */
export function isValidLocation(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= MAX_LATITUDE && Math.abs(lng) <= MAX_LONGITUDE
  );
}

/**
 * Parse an optional email: null when blank, "invalid" when it doesn't look like
 * one. Deliberately permissive: one @, a dot in the domain, no spaces, max length.
 */
export function parseEmail(raw: string): string | null | "invalid" {
  const email = raw.trim().toLowerCase();
  if (!email) return null;
  return email.length <= LIMITS.email && EMAIL_PATTERN.test(email) ? email : "invalid";
}

/** The citizen's category choice, accepted only if it is a known value. */
export function parseUserCategory(raw: string): Category | null {
  return isOneOf(CATEGORIES, raw) ? raw : null;
}

/**
 * The content rules for a report: it needs something to say and somewhere to
 * be. Returns the first problem, or null when the report is acceptable.
 */
export function validateReportContent(
  report: { title: string; description: string; hasAudio: boolean; lat: number; lng: number },
  verified: boolean,
): Failure | null {
  const hasText = Boolean(report.title || report.description);
  // A voice note alone is a valid report, so citizens who can't type
  // comfortably (or can't read English) are not excluded.
  if (!hasText && !report.hasAudio) return failure(400, "Add a title, a description or a voice note.");
  // Voice-only reports need Gemini to transcribe them, which is reserved for verified reporters.
  if (!verified && !hasText)
    return failure(400, "Add a written title or description, or verify your phone to send a voice-only report.");
  if (!isValidLocation(report.lat, report.lng)) return failure(400, "Pick a location on the map.");
  return null;
}

/**
 * Read and validate the report form. Every field is trimmed and length-capped
 * on the server; the API never trusts the browser. Errors are plain-language
 * messages the form shows as-is.
 */
export async function parseReportForm(form: FormData, verified: boolean): Promise<Result<{ report: ReportInput }>> {
  const email = parseEmail(formText(form, "email"));
  if (email === "invalid") return failure(400, "That email address doesn't look right.");

  // Shared upload checks (size caps, real file type) from uploads.ts.
  const imageUpload = await readImage(form.get("image"));
  if (!imageUpload.ok) return imageUpload;
  const audioUpload = await readAudio(form.get("audio"));
  if (!audioUpload.ok) return audioUpload;

  const report: ReportInput = {
    title: formText(form, "title", LIMITS.title),
    description: formText(form, "description", LIMITS.description),
    address: formText(form, "address", LIMITS.address),
    lat: parseCoordinate(formText(form, "lat")),
    lng: parseCoordinate(formText(form, "lng")),
    userCategory: parseUserCategory(formText(form, "category")),
    email,
    image: imageUpload.part,
    audio: audioUpload.part,
  };
  const problem = validateReportContent({ ...report, hasAudio: Boolean(report.audio) }, verified);
  return problem ?? { ok: true, report };
}

// ---- 3. Classification ------------------------------------------------------

/**
 * Reconcile the classifier's answer with the citizen's choice. The AI decides
 * the category; if the AI was unavailable, the citizen's own choice is
 * respected and the department follows the routing table.
 */
export function resolveRouting(
  classification: Classification,
  source: Triage["source"],
  userCategory: Category | null,
): Pick<Triage, "category" | "department"> {
  if (source === "gemini") return { category: classification.category, department: classification.department };
  const category = userCategory ?? classification.category;
  return { category, department: CATEGORY_DEPARTMENT[category] };
}

/**
 * Classify a report: category, priority and department. Never throws: on any
 * AI failure classifyIssue returns a rule-based result with source "fallback",
 * so the endpoint always succeeds for valid input. Held (unverified) reports
 * use the free rule-based classifier, so a flood of anonymous submissions can
 * never burn the Gemini quota.
 */
export async function classifyReport(report: ReportInput, verified: boolean): Promise<Triage> {
  const { title, description, address, image, audio } = report;
  if (!verified) {
    const classification = { ...fallbackClassify({ title, description }), priorityReason: UNVERIFIED_PRIORITY_REASON };
    return { classification, source: "fallback", ...resolveRouting(classification, "fallback", report.userCategory) };
  }
  const { result: classification, source, error } = await classifyIssue({ title, description, address, image, audio });
  // A structured log line, filterable in Cloud Logging (event="ai_fallback").
  // `error` is already a short, log-safe description (see describeError).
  if (error) log.warn("ai_fallback", { reason: error });
  return { classification, source, ...resolveRouting(classification, source, report.userCategory) };
}

// ---- 4. Duplicate detection -------------------------------------------------

/**
 * From the open tickets of one category, keep those within the duplicate
 * radius of `location`, nearest first, capped at MAX_DUPLICATE_CANDIDATES.
 * Held reports are never matched against.
 */
export function selectDuplicateCandidates(
  openTickets: Ticket[],
  location: { lat: number; lng: number },
): (Ticket & { distance: number })[] {
  return openTickets
    .filter((ticket) => !isHeld(ticket))
    .map((ticket) => ({ ...ticket, distance: haversine(ticket.location, location) }))
    .filter((candidate) => candidate.distance <= DUPLICATE_RADIUS_M)
    .sort((nearer, farther) => nearer.distance - farther.distance)
    .slice(0, MAX_DUPLICATE_CANDIDATES);
}

/**
 * Look for an open ticket about the same physical problem. A two-stage design:
 * listOpen() pushes the category/status filter down to the database, cheap
 * distance maths narrows the field, and only the few nearest candidates reach
 * the expensive AI check. Unverified reports are never merged into (or matched
 * against) the live queues.
 */
export async function findDuplicateTicket(
  db: Store,
  report: ReportInput,
  triage: Triage,
  verified: boolean,
): Promise<{ ticket: Ticket; reason: string } | null> {
  const openTickets = verified ? await db.listOpen(triage.category) : [];
  const candidates = selectDuplicateCandidates(openTickets, report);
  const match = await findDuplicate(
    { summary: triage.classification.englishSummary, category: triage.category, image: report.image },
    candidates,
  );
  if (!match.id) return null;
  const ticket = await db.get(match.id);
  return ticket ? { ticket, reason: match.reason } : null;
}

// ---- 5a. Merge into an existing ticket --------------------------------------

/**
 * The existing ticket with one more reporter. The new reporter is counted
 * (public impact), priority is recomputed, the merge is logged on the public
 * timeline with the AI's reason, and the ticket gains a photo if it had none.
 */
export function withAdditionalReporter(
  existing: Ticket,
  merge: { reporter: Reporter; reason: string; hasNewImage: boolean; now: string },
): Ticket {
  return recomputePriority(
    appendHistory(
      {
        ...existing,
        reporterCount: existing.reporterCount + 1,
        reporters: [...(existing.reporters ?? []), merge.reporter],
        updatedAt: merge.now,
        hasImage: existing.hasImage || merge.hasNewImage,
      },
      { status: existing.status, at: merge.now, note: `Another citizen reported this (${merge.reason})` },
    ),
  );
}

/**
 * Merge a report into the ticket it duplicates, instead of discarding it. The
 * citizen is told their report joined an existing ticket and gets their own
 * private link to it: no dead-end "duplicate rejected" message.
 */
export async function mergeIntoDuplicate(
  db: Store,
  existing: Ticket,
  merge: { reporter: Reporter; reason: string; image: MediaPart | null; now: string; aiSource: Triage["source"] },
): Promise<Ticket> {
  if (merge.image && !existing.hasImage) await db.putImage(existing.id, merge.image);
  // Applied to the latest stored version, so a reporter merged at the same moment is never lost.
  const merged = await db.update(existing.id, (current) =>
    withAdditionalReporter(current, { ...merge, hasNewImage: Boolean(merge.image) }),
  );
  if (!merged) throw new Error(`Ticket ${existing.id} disappeared while merging a duplicate report.`);
  log.info("ticket_merged", { id: merged.id, reporterCount: merged.reporterCount, aiSource: merge.aiSource });
  return merged;
}

// ---- 5b. Create a new ticket ------------------------------------------------

/** Everything needed to turn a classified report into a ticket. */
export interface NewTicketInput {
  id: string;
  report: ReportInput;
  triage: Triage;
  reporter: Reporter;
  verified: boolean;
  now: string;
}

/**
 * Build the ticket for a new report. Safety rules run over the citizen's text,
 * the English summary and the voice transcript, so hazards are caught in any
 * language; if a rule changed the AI's priority, the reason says so.
 */
export function buildTicket({ id, report, triage, reporter, verified, now }: NewTicketInput): Ticket {
  const { classification, category, department } = triage;
  const safetyHit = safetyRuleHit(
    safetyScanText({
      title: report.title,
      description: report.description,
      englishSummary: classification.englishSummary,
      transcript: classification.transcript,
    }),
  );
  const { priority, note: priorityNote } = effectivePriority(classification.priority, 1, safetyHit);
  const routingNote = verified
    ? `Routed to ${department}`
    : `Held for review: sent without phone verification (suggested: ${department})`;
  return {
    id,
    // Voice-only reports still get a proper title and description from Gemini.
    title: report.title || classification.title,
    description: report.description || classification.transcript || classification.englishSummary,
    originalLanguage: classification.detectedLanguage,
    englishSummary: classification.englishSummary,
    transcript: classification.transcript,
    category,
    priority,
    basePriority: classification.priority, // the AI's original call, kept for transparent recomputation
    priorityReason: priorityNote ? `${priorityNote} ${classification.priorityReason}` : classification.priorityReason,
    department, // appears in this department's queue immediately
    status: "Reported",
    location: { lat: report.lat, lng: report.lng, address: report.address },
    reporterCount: 1,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    adminNotes: [],
    hasImage: Boolean(report.image),
    history: [{ status: "Reported", at: now, note: routingNote }],
    verification: verified ? "phone" : "unverified",
    classifiedBy: triage.source, // audit trail: staff see which tickets need a human check
    acknowledgedAt: null,
    expectedFixDate: null,
    transfers: 0,
    messages: [],
    reporters: [reporter],
    resolution: null,
    citizenConfirmation: null,
    reopenCount: 0,
  };
}

/** The acknowledgement emailed to the reporter of a new ticket. */
export function receiptText(ticket: Ticket, verified: boolean): string {
  return verified
    ? `Thank you. Your report was classified as ${ticket.category} (${ticket.priority} priority) and sent to ${ticket.department}.`
    : `Thank you. Because it was sent without phone verification, a city officer will review it before it goes to ${ticket.department}.`;
}

/** Save a new ticket (routed to its department's queue, or held for review) and acknowledge it by email. */
export async function createTicket(db: Store, input: Omit<NewTicketInput, "id">, origin: string): Promise<Ticket> {
  const ticket = await db.create((id) => buildTicket({ ...input, id }));
  // Images are stored separately so list queries stay small and fast.
  if (input.report.image) await db.putImage(ticket.id, input.report.image);
  // Logs carry only IDs and labels, never the citizen's text, photo, email or location.
  log.info("ticket_created", {
    id: ticket.id,
    category: ticket.category,
    priority: ticket.priority,
    department: ticket.department,
    aiSource: input.triage.source,
    verified: input.verified,
  });
  await notifyReporters(ticket, "We received your report", receiptText(ticket, input.verified), origin);
  return ticket;
}
