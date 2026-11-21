// =============================================================================
// Shared HTTP helpers for the API routes
// -----------------------------------------------------------------------------
// Every route answers errors as `{ error: "<plain-language message>" }` with a
// matching status (429s also carry Retry-After), and several routes repeat the
// same "check the budget, load the ticket, check who is asking" preamble.
// Keeping both here means the wording, the status codes and the order of the
// checks cannot drift between endpoints.
// =============================================================================
import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { authenticateStaff, canActOn } from "./auth";
import { CITIZEN_KEY_HEADER } from "./headers";
import { log } from "./log";
import { failure, rateLimited, success, type Failure, type Result } from "./result";
import { clientIp, rateLimit, type RateLimitResult } from "./security";
import { store, type Store } from "./store";
import { TICKET_ID_PATTERN, type Role, type Ticket } from "./types";
import { MAX_FORM_BYTES } from "./uploads";
import { isReporter } from "./workflow";

/** Live data: never let a CDN or browser serve a stale ticket status. */
export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

/** Error messages used by more than one route, so their wording stays identical everywhere. */
export const ERROR_MESSAGES = {
  ticketNotFound: "Ticket not found.",
  staffSignInRequired: "Staff sign-in required.",
  otherDepartment: "This ticket is assigned to another department.",
  notYourTicket: "Use the private link you received when reporting.",
  expectedFormData: "Expected multipart form data.",
  formTooLarge: "The upload is too large.",
  tooManyRequests: "Too many requests. Please wait a few minutes.",
} as const;

/** The standard error response: `{ error: message }` with the given status. */
export function fail(status: number, message: string, headers?: HeadersInit): NextResponse<{ error: string }> {
  return NextResponse.json({ error: message }, { status, headers });
}

/** Turn a `Failure` from the domain layer into the standard error response (with Retry-After on a 429). */
export function failWith({ status, error, retryAfterSec }: Failure): NextResponse<{ error: string }> {
  return fail(status, error, retryAfterSec === undefined ? undefined : { "Retry-After": String(retryAfterSec) });
}

/** The 429 answer for a caller over a rate limit, always telling them when to retry. */
export function tooManyRequests(
  limit: RateLimitResult,
  message: string = ERROR_MESSAGES.tooManyRequests,
): NextResponse<{ error: string }> {
  return failWith(rateLimited(message, limit.retryAfterSec));
}

/**
 * Origin for absolute links in emails. In production it must be configured as
 * PUBLIC_BASE_URL (the Cloud Run URL): the request's Host header is chosen by
 * the client, so trusting it would let anyone make the server email links to
 * their own site. Outside production the request's origin is used, so local
 * development needs no setup.
 */
export function baseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    log.error("public_base_url_missing");
    throw new Error("PUBLIC_BASE_URL must be set in production.");
  }
  return new URL(req.url).origin;
}

/**
 * The request's multipart form. A body declaring more than MAX_FORM_BYTES is
 * refused (413) before it is read, so an oversized upload is never buffered;
 * one that isn't a form is a 400. Each file's own cap is checked in uploads.ts.
 */
export async function readFormData(req: Request): Promise<Result<{ form: FormData }>> {
  if (Number(req.headers.get("content-length")) > MAX_FORM_BYTES) return failure(413, ERROR_MESSAGES.formTooLarge);
  const form = await req.formData().catch(() => null);
  return form ? success({ form }) : failure(400, ERROR_MESSAGES.expectedFormData);
}

/** The request's JSON body parsed by `schema`, or null when it is missing, malformed or doesn't match. */
export async function readJsonBody<Schema extends z.ZodType>(
  req: Request,
  schema: Schema,
): Promise<z.output<Schema> | null> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/** A trimmed text field from a form, capped at `maxLength`. Missing fields and files read as "". */
export function formText(form: FormData, field: string, maxLength = Infinity): string {
  const value = form.get(field);
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/**
 * A per-IP request budget for one endpoint: `bucket` names it, `max` is its
 * size per rate-limit window (default RATE_MAX) and `message` what a caller
 * over it is told.
 */
export interface RequestBudget {
  bucket: string;
  max?: number;
  message?: string;
}

/** Spend one request of the caller's budget: a 429 `Failure` once it is used up, otherwise null. */
export function spendBudget(
  req: Request,
  { bucket, max, message = ERROR_MESSAGES.tooManyRequests }: RequestBudget,
): Failure | null {
  const limit = rateLimit(`${bucket}:${clientIp(req)}`, { max });
  return limit.ok ? null : rateLimited(message, limit.retryAfterSec);
}

/**
 * Look up the ticket named in a URL. Case-insensitive ("cr-1004" typed on a
 * phone still finds CR-1004), and anything that isn't a ticket id is simply
 * not found, without a database read.
 */
export async function findTicket(db: Store, id: string): Promise<Ticket | null> {
  const ticketId = id.toUpperCase();
  return TICKET_ID_PATTERN.test(ticketId) ? db.get(ticketId) : null;
}

/** The signed-in staff role: 401 without a valid passcode, 429 while the caller is locked out for guessing. */
export function requireStaff(req: Request): Result<{ role: Role }> {
  const auth = authenticateStaff(req);
  if (!auth.ok) return auth;
  return auth.role ? success({ role: auth.role }) : failure(401, ERROR_MESSAGES.staffSignInRequired);
}

/**
 * Authorise a staff request against one ticket. Authentication and
 * authorisation are enforced here on the server, not just by hiding UI, in
 * this order: no passcode → 401, budget used up → 429 (before any database
 * work), unknown ticket → 404, another department's ticket → 403.
 */
export async function loadTicketForStaff(
  req: Request,
  id: string,
  budget: RequestBudget,
): Promise<Result<{ ticket: Ticket; role: Role; db: Store }>> {
  const staff = requireStaff(req);
  if (!staff.ok) return staff;
  const overBudget = spendBudget(req, budget);
  if (overBudget) return overBudget;
  const db = store();
  const ticket = await findTicket(db, id);
  if (!ticket) return failure(404, ERROR_MESSAGES.ticketNotFound);
  if (!canActOn(staff.role, ticket)) return failure(403, ERROR_MESSAGES.otherDepartment);
  return success({ ticket, role: staff.role, db });
}

/**
 * Authorise a citizen request against one ticket: only someone holding a
 * private link to this ticket may act on it. Budget used up → 429 (before any
 * database work), unknown ticket → 404, no valid link → 403.
 */
export async function loadTicketForReporter(
  req: Request,
  id: string,
  budget: RequestBudget,
): Promise<Result<{ ticket: Ticket; db: Store }>> {
  const overBudget = spendBudget(req, budget);
  if (overBudget) return overBudget;
  const db = store();
  const ticket = await findTicket(db, id);
  if (!ticket) return failure(404, ERROR_MESSAGES.ticketNotFound);
  if (!isReporter(ticket, req.headers.get(CITIZEN_KEY_HEADER))) return failure(403, ERROR_MESSAGES.notYourTicket);
  return success({ ticket, db });
}

/**
 * Decide a change against the latest stored version of a ticket and save it in
 * one atomic step (see `Store.update`). `decide` returns the outcome the route
 * answers with; on success its `ticket` is what gets saved, on failure nothing
 * is. It may run more than once under contention, so it must be pure.
 */
export async function updateTicketAtomically<Outcome extends Result<{ ticket: Ticket }>>(
  db: Store,
  id: string,
  decide: (current: Ticket) => Outcome,
): Promise<Outcome | Failure> {
  const last: { outcome?: Outcome } = {};
  await db.update(id, (current) => {
    last.outcome = decide(current);
    return last.outcome.ok ? last.outcome.ticket : null;
  });
  return last.outcome ?? failure(404, ERROR_MESSAGES.ticketNotFound);
}
