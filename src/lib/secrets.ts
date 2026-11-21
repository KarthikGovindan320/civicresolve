// =============================================================================
// Signing secrets: one rule for every HMAC key the server uses
// -----------------------------------------------------------------------------
// Private links, held-photo links and OTP challenges are all HMAC-signed. In
// production the key must come from the environment (Secret Manager on Cloud
// Run); if it is missing the server refuses to sign or verify anything rather
// than fall back to a guessable value. Local development and tests use a fixed
// key, so the app runs with zero configuration.
// =============================================================================
import "server-only";

/** Used only outside production. Never valid on the deployed service. */
const DEVELOPMENT_SECRET = "civicresolve-development-only-secret";

/** The first of the named environment variables that is set; in production, an error if none is. */
export function signingSecret(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  if (process.env.NODE_ENV === "production") throw new Error(`${names.join(" or ")} must be set in production.`);
  return DEVELOPMENT_SECRET;
}
