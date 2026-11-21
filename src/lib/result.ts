// A tiny result type shared by validation, upload handling and the ticket
// workflow. Failures carry the HTTP status and the plain-language message the
// client shows as-is, so a route can turn one into a response without
// re-deciding either.

/** A failed operation: the HTTP status to answer with and the message shown to the user. */
export interface Failure {
  ok: false;
  status: number;
  error: string;
}

/** Either the successful payload (flagged `ok: true`) or a `Failure`. */
export type Result<T extends object> = ({ ok: true } & T) | Failure;

/** Build a `Failure` for the given HTTP status and user-facing message. */
export function failure(status: number, error: string): Failure {
  return { ok: false, status, error };
}
