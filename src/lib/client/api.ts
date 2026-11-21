/**
 * Typed fetch helper for the JSON API, so every screen builds its headers and
 * reads `{ error }` responses the same way.
 */
import { CITIZEN_KEY_HEADER, STAFF_KEY_HEADER } from "@/lib/headers";
import type { MessageKey, Translate } from "@/lib/i18n";

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

/** The `error` message of an error response body, if it has one. */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null || !("error" in payload)) return undefined;
  return typeof payload.error === "string" ? payload.error : undefined;
}

/**
 * The client's single trust point: a successful body is taken to be the `T`
 * the caller asked for, without checking it. Every response comes from this
 * app's own route handlers, which build it from typed domain values, so
 * re-validating it here would only add a schema library to the browser bundle.
 */
const trustedPayload = <T>(payload: unknown) => payload as T;

/**
 * Calls the API and parses the JSON response. HTTP errors are returned as a
 * result so callers can show the server's message; only network failures
 * (and unparseable responses) throw. Screens use `settle` to handle both.
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
  const payload: unknown = await response.json();
  if (response.ok) return { ok: true, data: trustedPayload<T>(payload) };
  return { ok: false, status: response.status, error: errorMessage(payload) };
}

/** A request's outcome reduced to its data or a message ready to show. */
export type Settled<T> = { ok: true; data: T } | { ok: false; error: string };

/** The messages `settle` shows when the server gives no message of its own, or the request never completes. */
export interface FailureMessages {
  /** For an HTTP error whose body carries no message. */
  failed: string;
  /** For a network failure or an unreadable response. */
  network: string;
}

/** The usual failure messages in the interface language, optionally with a more specific one for HTTP errors. */
export const failureMessages = (t: Translate, failed: MessageKey = "common.error.generic"): FailureMessages => ({
  failed: t(failed),
  network: t("common.error.network"),
});

/**
 * Awaits a request and never throws: the result is the data, the server's own
 * error message, or one of `messages`. Every screen handles failures through
 * this, so none can leave a busy state stuck or swallow a network error.
 */
export async function settle<T>(request: Promise<ApiResult<T>>, messages: FailureMessages): Promise<Settled<T>> {
  try {
    const result = await request;
    return result.ok ? result : { ok: false, error: result.error ?? messages.failed };
  } catch {
    return { ok: false, error: messages.network };
  }
}

/** Request options for the helpers that supply the caller's key themselves. */
export type KeyedRequestOptions = Omit<ApiRequestOptions, "staffKey" | "citizenKey">;

/** Calls the API as a signed-in staff member (city admin or department). */
export const staffRequest = <T>(path: string, staffKey: string, options: KeyedRequestOptions = {}) =>
  apiRequest<T>(path, { ...options, staffKey });

/** Calls the API as the citizen who holds a ticket's private link. */
export const citizenRequest = <T>(path: string, citizenKey: string, options: KeyedRequestOptions = {}) =>
  apiRequest<T>(path, { ...options, citizenKey });
