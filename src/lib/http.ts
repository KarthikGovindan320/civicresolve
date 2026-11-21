// =============================================================================
// Shared HTTP helpers for the API routes
// -----------------------------------------------------------------------------
// Every route answers errors as `{ error: "<plain-language message>" }` with a
// matching status, and several routes repeat the same "load the ticket, check
// who is asking" preamble. Keeping both here means the wording, the status
// codes and the order of the checks cannot drift between endpoints.
// =============================================================================
import "server-only";
import { NextResponse } from "next/server";
import { canActOn, staffRole } from "./auth";
import { failure, type Failure, type Result } from "./result";
import { store, type Store } from "./store";
import type { Role, Ticket } from "./types";
import { isReporter } from "./workflow";

/** Header carrying a citizen's private-link token. */
export const CITIZEN_KEY_HEADER = "x-citizen-key";

/** Live data: never let a CDN or browser serve a stale ticket status. */
export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

/** Error messages used by more than one route, so their wording stays identical everywhere. */
export const ERROR_MESSAGES = {
  ticketNotFound: "Ticket not found.",
  staffSignInRequired: "Staff sign-in required.",
  otherDepartment: "This ticket is assigned to another department.",
  notYourTicket: "Use the private link you received when reporting.",
  expectedFormData: "Expected multipart form data.",
} as const;

/** The standard error response: `{ error: message }` with the given status. */
export function fail(status: number, message: string, headers?: HeadersInit): NextResponse<{ error: string }> {
  return NextResponse.json({ error: message }, { status, headers });
}

/** Turn a `Failure` from the domain layer into the standard error response. */
export function failWith({ status, error }: Failure): NextResponse<{ error: string }> {
  return fail(status, error);
}

/**
 * Origin for absolute links in emails and responses. PUBLIC_BASE_URL is the
 * Cloud Run URL in production; otherwise the origin of the current request.
 */
export function baseUrl(req: Request): string {
  return (process.env.PUBLIC_BASE_URL || new URL(req.url).origin).replace(/\/$/, "");
}

/** The request's multipart form, or null if the body isn't one. */
export async function readFormData(req: Request): Promise<FormData | null> {
  return req.formData().catch(() => null);
}

/** The request's JSON object. A missing, malformed or non-object body reads as `{}`. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => null);
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

/** A trimmed text field from a form, capped at `maxLength`. Missing fields read as "". */
export function formText(form: FormData, field: string, maxLength = Infinity): string {
  return String(form.get(field) ?? "")
    .trim()
    .slice(0, maxLength);
}

/**
 * Authorise a staff request against one ticket. Authentication and
 * authorisation are enforced here on the server, not just by hiding UI:
 * no passcode → 401, unknown ticket → 404, another department's ticket → 403.
 */
export async function loadTicketForStaff(
  req: Request,
  id: string,
): Promise<Result<{ ticket: Ticket; role: Role; db: Store }>> {
  const role = staffRole(req);
  if (!role) return failure(401, ERROR_MESSAGES.staffSignInRequired);
  const db = store();
  const ticket = await db.get(id);
  if (!ticket) return failure(404, ERROR_MESSAGES.ticketNotFound);
  if (!canActOn(role, ticket)) return failure(403, ERROR_MESSAGES.otherDepartment);
  return { ok: true, ticket, role, db };
}

/**
 * Authorise a citizen request against one ticket: only someone holding a
 * private link to this ticket may act on it. Unknown ticket → 404, no valid link → 403.
 */
export async function loadTicketForReporter(req: Request, id: string): Promise<Result<{ ticket: Ticket; db: Store }>> {
  const db = store();
  const ticket = await db.get(id);
  if (!ticket) return failure(404, ERROR_MESSAGES.ticketNotFound);
  if (!isReporter(ticket, req.headers.get(CITIZEN_KEY_HEADER))) return failure(403, ERROR_MESSAGES.notYourTicket);
  return { ok: true, ticket, db };
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
