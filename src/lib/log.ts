// =============================================================================
// Structured logging for Google Cloud Logging
// -----------------------------------------------------------------------------
// On Cloud Run, anything written to stdout as a single-line JSON object is
// parsed by Google Cloud Logging: `severity` becomes the log level and the
// other fields become searchable structured data. So we can filter in the Cloud
// Console for "every AI fallback in the last hour" (event="ai_fallback") with no
// logging SDK and no extra dependency. Locally it is still readable JSON.
// Secrets and citizens' personal data are never passed to these functions.
// =============================================================================

type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";
type LogFields = Record<string, unknown>;

function write(severity: Severity, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({ severity, event, message: event, time: new Date().toISOString(), ...fields });
  // Tests set LOG_SILENT=1 to keep output clean.
  if (process.env.LOG_SILENT) return;
  (severity === "ERROR" ? console.error : console.log)(line);
}

/** Structured logger: `event` is a stable, searchable name; `fields` must never contain personal data. */
export const log = {
  info: (event: string, fields?: LogFields) => write("INFO", event, fields),
  warn: (event: string, fields?: LogFields) => write("WARNING", event, fields),
  error: (event: string, fields?: LogFields) => write("ERROR", event, fields),
};

/** Longest error text copied into a log line; enough to diagnose, short enough to keep logs tidy. */
export const MAX_LOGGED_ERROR_CHARS = 200;

/** A short, log-safe description of a caught error. */
export function describeError(error: unknown, maxChars = MAX_LOGGED_ERROR_CHARS): string {
  return String(error).slice(0, maxChars);
}
