/**
 * Typed fetch helper for the JSON API, so every screen builds its headers and
 * reads `{ error }` responses the same way.
 */

/** Header carrying the staff passcode; the server derives the role from it. */
const STAFF_KEY_HEADER = "x-staff-key";
/** Header carrying the citizen's private-link token. A header rather than a body field, so it is not logged with the payload. */
const CITIZEN_KEY_HEADER = "x-citizen-key";

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH";
  /** Sent as a JSON body with a JSON content type. */
  json?: unknown;
  /** Sent as multipart form data; the browser sets the content type and boundary. */
  form?: FormData;
  staffKey?: string;
  citizenKey?: string;
}

/** A parsed API response: the payload on success, or the server's error message (if it sent one). */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error?: string };

/**
 * Calls the API and parses the JSON response. HTTP errors are returned as a
 * result so callers can show the server's message; only network failures
 * (and unparseable responses) throw.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.staffKey !== undefined) headers[STAFF_KEY_HEADER] = options.staffKey;
  if (options.citizenKey !== undefined) headers[CITIZEN_KEY_HEADER] = options.citizenKey;
  if (options.json !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(path, {
    method: options.method,
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.form,
  });
  const payload = await response.json();
  if (response.ok) return { ok: true, data: payload as T };
  return { ok: false, status: response.status, error: typeof payload?.error === "string" ? payload.error : undefined };
}

/** Request options for the helpers that supply the caller's key themselves. */
export type KeyedRequestOptions = Omit<ApiRequestOptions, "staffKey" | "citizenKey">;

/** Calls the API as a signed-in staff member (city admin or department). */
export const staffRequest = <T>(path: string, staffKey: string, options: KeyedRequestOptions = {}) =>
  apiRequest<T>(path, { ...options, staffKey });

/** Calls the API as the citizen who holds a ticket's private link. */
export const citizenRequest = <T>(path: string, citizenKey: string, options: KeyedRequestOptions = {}) =>
  apiRequest<T>(path, { ...options, citizenKey });
