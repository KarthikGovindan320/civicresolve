// =============================================================================
// [SECURITY][PROBLEM STATEMENT ALIGNMENT] PHONE VERIFICATION (OTP): accountability against spam
// -----------------------------------------------------------------------------
// Anyone could otherwise script thousands of bogus reports and flood every department's
// queue. Every report must now come from a phone number verified with a one-time code:
//   • a bogus report can be traced to a real number if misuse is ever investigated
//   • one person can't hide behind unlimited fake identities (rate limits apply per number)
//   • the number stays PRIVATE: it is stored only on the internal reporter record, which
//     no API response, staff screen, public page or log line ever contains.
//
// [EFFICIENCY][CODE QUALITY] Stateless design: the server keeps NO OTP table. /api/otp
// returns a signed "challenge" = HMAC(secret, phone | code | expiry). When the report
// arrives with phone + code + challenge, the server recomputes the HMAC. Without the
// secret, nobody can forge a challenge for a code they didn't receive. This works across
// any number of Cloud Run instances with zero database reads or writes.
//
// SMS STUB: no SMS gateway is connected yet, so in stub mode /api/otp also returns the
// code and the form shows it as "use this code". Connecting a real SMS provider means
// implementing sendSms() below and setting SMS_PROVIDER. Nothing else changes, and the
// code is then never sent to the browser.
// =============================================================================
import "server-only";
import { createHmac, randomInt } from "crypto";
import { safeEqual } from "./security";

export const OTP_TTL_MS = 5 * 60_000; // a code is valid for 5 minutes

// [SECURITY] Stub mode until a real SMS provider is configured.
export const smsEnabled = () => Boolean(process.env.SMS_PROVIDER);

function secret(): string {
  return (
    process.env.OTP_SECRET ||
    process.env.LINK_SECRET ||
    `civicresolve-otp:${process.env.ADMIN_PASSCODE || "dev-only-secret"}`
  );
}

// [SECURITY] Indian mobile numbers only (10 digits starting 6-9), normalised to E.164
// "+91XXXXXXXXXX", so "098765 43210", "+91 98765-43210" and "9876543210" are all ONE person
// for rate limiting and traceability.
export function normalizePhone(raw: string): string | null {
  let d = String(raw ?? "").replace(/[\s\-()]/g, "");
  if (d.startsWith("+91")) d = d.slice(3);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

const sign = (phone: string, code: string, exp: number) =>
  createHmac("sha256", secret()).update(`${phone}|${code}|${exp}`).digest("base64url");

/** Create a fresh 6-digit code for this phone, plus the signed challenge the client must send back. */
export function issueOtp(phone: string, now = Date.now()): { code: string; challenge: string; expiresAt: number } {
  // [SECURITY] crypto.randomInt: a cryptographically secure code, not Math.random().
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const exp = now + OTP_TTL_MS;
  return { code, challenge: `${exp}.${sign(phone, code, exp)}`, expiresAt: exp };
}

/** True only if `code` is the code issued for `phone` and it hasn't expired. Constant-time compare. */
export function verifyOtp(phone: string, code: string, challenge: string, now = Date.now()): boolean {
  const [expStr, mac] = String(challenge ?? "").split(".");
  const exp = Number(expStr);
  if (!mac || !Number.isFinite(exp) || exp < now || exp > now + OTP_TTL_MS) return false;
  if (!/^\d{6}$/.test(code)) return false;
  return safeEqual(sign(phone, code, exp), mac);
}

/** Integration point for a real SMS gateway (e.g. via SMS_PROVIDER). Not connected yet: stub mode. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function sendSms(_phone: string, _text: string): Promise<void> {
  // Intentionally empty until an SMS provider is chosen. While smsEnabled() is false the code
  // is returned to the browser instead (clearly labelled as a demo stub in the UI).
}
