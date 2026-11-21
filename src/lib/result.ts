// A tiny result type shared by validation, upload handling and the ticket
// workflow. Failures carry the HTTP status and the plain-language message the
// client shows as-is, so a route can turn one into a response without
// re-deciding either.

/** A failed operation: the HTTP status to answer with and the message shown to the user. */
export interface Failure {
  ok: false;
  status: number;
  error: string;
  /** Set on a 429: seconds until the caller may try again (sent as the Retry-After header). */
  retryAfterSec?: number;
}

/** Either the successful payload (flagged `ok: true`) or a `Failure`. */
export type Result<T extends object> = ({ ok: true } & T) | Failure;

/** Build a `Failure` for the given HTTP status and user-facing message. */
export function failure(status: number, error: string): Failure {
  return { ok: false, status, error };
}

/** Build the 429 `Failure` for a caller over a rate limit, carrying how long they must wait. */
export function rateLimited(error: string, retryAfterSec: number): Failure {
  return { ...failure(429, error), retryAfterSec };
}

/** Build a successful result carrying `value`. */
export function success<T extends object>(value: T): { ok: true } & T {
  return { ok: true, ...value };
}
