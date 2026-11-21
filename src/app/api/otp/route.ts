// =============================================================================
// POST /api/otp: send a one-time code to the citizen's phone (anti-spam)
// -----------------------------------------------------------------------------
// Body: { phone }. Returns { challenge, expiresAt, phone (normalised), stub }, plus, in demo
// mode only (no SMS gateway yet, see demoCodesAllowed), { devCode } so the form can show it.
// Rate-limited per IP and per phone number, so it can't be used to spam someone's phone.
// The phone number is never written to logs.
// =============================================================================
import { NextResponse } from "next/server";
import { NO_STORE_HEADERS, fail, failWith, readJsonBody, spendBudget, tooManyRequests } from "@/lib/http";
import { log } from "@/lib/log";
import { OTP_TTL_MINUTES, demoCodesAllowed, issueOtp, normalizePhone, sendSms, smsEnabled } from "@/lib/otp";
import { OtpRequestSchema } from "@/lib/schemas";
import { rateLimit } from "@/lib/security";

const TOO_MANY_CODES = "Too many codes requested. Please wait a few minutes.";

/** Issue a one-time code and the signed challenge the report form must send back with it. */
export async function POST(req: Request) {
  // Two independent budgets: one device can't request codes for many numbers,
  // and one number can't be bombarded with codes from many devices.
  const overBudget = spendBudget(req, { bucket: "otp-ip", message: TOO_MANY_CODES });
  if (overBudget) {
    log.warn("otp_rate_limited");
    return failWith(overBudget);
  }
  const body = await readJsonBody(req, OtpRequestSchema);
  const phone = body && normalizePhone(body.phone);
  if (!phone) return fail(400, "Enter a valid 10-digit Indian mobile number.");
  const phoneLimit = rateLimit(`otp-phone:${phone}`);
  if (!phoneLimit.ok) {
    log.warn("otp_rate_limited");
    return tooManyRequests(phoneLimit, TOO_MANY_CODES);
  }

  // Fail closed: with neither an SMS gateway nor demo codes switched on, no code is issued at all.
  const stub = demoCodesAllowed();
  if (!stub && !smsEnabled()) {
    log.error("otp_unavailable_no_sms_provider");
    return fail(503, "Phone verification is unavailable right now. You can send the report without verifying.");
  }
  const { code, challenge, expiresAt } = issueOtp(phone);
  if (!stub) await sendSms(phone, `Your CivicResolve code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`);
  log.info("otp_issued", { stub });
  return NextResponse.json(
    { challenge, expiresAt, phone, stub, ...(stub ? { devCode: code } : {}) },
    { headers: NO_STORE_HEADERS },
  );
}
