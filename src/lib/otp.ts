// =============================================================================
// Phone verification (OTP): accountability against spam
// -----------------------------------------------------------------------------
// Anyone could otherwise script thousands of bogus reports and flood every department's
// queue. A report that goes straight to a department must come from a phone number
// verified with a one-time code:
//   • a bogus report can be traced to a real number if misuse is ever investigated
//   • one person can't hide behind unlimited fake identities (rate limits apply per number)
//   • the number stays private: it is stored only on the internal reporter record, which
//     no API response, staff screen, public page or log line ever contains.
//
// Stateless design: the server keeps no OTP table. /api/otp returns a signed
// "challenge" = HMAC(secret, phone | code | expiry). When the report arrives with
// phone + code + challenge, the server recomputes the HMAC. Without the secret, nobody
// can forge a challenge for a code they didn't receive. This works across any number of
// Cloud Run instances with zero database reads or writes.
//
// SMS stub: no SMS gateway is connected yet, so in stub mode /api/otp also returns the
// code and the form shows it as "use this code". Connecting a real SMS provider means
// implementing sendSms() below and setting SMS_PROVIDER. Nothing else changes, and the
// code is then never sent to the browser.
// =============================================================================
import "server-only";
import { createHmac, randomInt } from "crypto";
import { safeEqual } from "./security";

/** How long a one-time code stays valid. */
export const OTP_TTL_MS = 5 * 60_000;
export const OTP_TTL_MINUTES = OTP_TTL_MS / 60_000;

const OTP_DIGITS = 6;
const OTP_PATTERN = new RegExp(`^\\d{${OTP_DIGITS}}$`);
const INDIA_COUNTRY_CODE = "91";
/** Indian mobile numbers: ten digits, starting 6-9. */
const INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;

/** Whether a real SMS gateway is configured; until then the API runs in stub mode. */
export const smsEnabled = () => Boolean(process.env.SMS_PROVIDER);

function otpSecret(): string {
  return (
    process.env.OTP_SECRET ||
    process.env.LINK_SECRET ||
    `civicresolve-otp:${process.env.ADMIN_PASSCODE || "dev-only-secret"}`
  );
}

/**
 * Normalise an Indian mobile number to E.164 ("+91XXXXXXXXXX"), or null if it isn't
 * one. "098765 43210", "+91 98765-43210" and "9876543210" all become the same
 * value, so they count as one person for rate limiting and traceability.
 */
export function normalizePhone(raw: string): string | null {
  let digits = String(raw ?? "").replace(/[\s\-()]/g, "");
  if (digits.startsWith(`+${INDIA_COUNTRY_CODE}`)) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith(INDIA_COUNTRY_CODE)) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return INDIAN_MOBILE_PATTERN.test(digits) ? `+${INDIA_COUNTRY_CODE}${digits}` : null;
}

const sign = (phone: string, code: string, expiresAt: number) =>
  createHmac("sha256", otpSecret()).update(`${phone}|${code}|${expiresAt}`).digest("base64url");

/** Create a fresh 6-digit code for this phone, plus the signed challenge the client must send back. */
export function issueOtp(phone: string, now = Date.now()): { code: string; challenge: string; expiresAt: number } {
  // crypto.randomInt gives a cryptographically secure code, unlike Math.random().
  const code = String(randomInt(0, 10 ** OTP_DIGITS)).padStart(OTP_DIGITS, "0");
  const expiresAt = now + OTP_TTL_MS;
  return { code, challenge: `${expiresAt}.${sign(phone, code, expiresAt)}`, expiresAt };
}

/** True only if `code` is the code issued for `phone` and it hasn't expired. Constant-time compare. */
export function verifyOtp(phone: string, code: string, challenge: string, now = Date.now()): boolean {
  const [expiryText, signature] = String(challenge ?? "").split(".");
  const expiresAt = Number(expiryText);
  if (!signature || !Number.isFinite(expiresAt) || expiresAt < now || expiresAt > now + OTP_TTL_MS) return false;
  if (!OTP_PATTERN.test(code)) return false;
  return safeEqual(sign(phone, code, expiresAt), signature);
}

/** Integration point for a real SMS gateway (e.g. via SMS_PROVIDER). Not connected yet: stub mode. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function sendSms(_phone: string, _text: string): Promise<void> {
  // Intentionally empty until an SMS provider is chosen. While smsEnabled() is false the code
  // is returned to the browser instead (clearly labelled as a demo stub in the UI).
}
