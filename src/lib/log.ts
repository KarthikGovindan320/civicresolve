// =============================================================================
// [GOOGLE SERVICES][CODE QUALITY] Structured logging for Google Cloud Logging
// -----------------------------------------------------------------------------
// On Cloud Run, anything written to stdout as a single-line JSON object is
// parsed by Google Cloud Logging: `severity` becomes the log level and the
// other fields become searchable structured data. So we can filter in the Cloud
// Console for "every AI fallback in the last hour" (event="ai_fallback") with no
// logging SDK and no extra dependency. Locally it is still readable JSON.
// Secrets and citizens' personal data are never passed to these functions.
// =============================================================================

type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

function write(severity: Severity, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ severity, event, message: event, time: new Date().toISOString(), ...fields });
  // Tests set LOG_SILENT=1 to keep output clean.
  if (process.env.LOG_SILENT) return;
  (severity === "ERROR" ? console.error : console.log)(line);
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => write("INFO", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("WARNING", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("ERROR", event, fields),
};
