// =============================================================================
// POST /api/otp: send a one-time code to the citizen's phone (anti-spam)
// -----------------------------------------------------------------------------
// Body: { phone }. Returns { challenge, expiresAt, phone (normalised), stub }, plus, in stub
// mode only (no SMS gateway yet), { devCode } so the demo can show "use this code".
// Rate-limited per IP and per phone number, so it can't be used to spam someone's phone.
// The phone number is never written to logs.
// =============================================================================
import { NextResponse } from "next/server";
import { NO_STORE_HEADERS, fail, readJsonBody } from "@/lib/http";
import { log } from "@/lib/log";
import { OTP_TTL_MINUTES, issueOtp, normalizePhone, sendSms, smsEnabled } from "@/lib/otp";
import { clientIp, rateLimit } from "@/lib/security";

/** Issue a one-time code and the signed challenge the report form must send back with it. */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  const phone = normalizePhone(String(body.phone ?? ""));
  if (!phone) return fail(400, "Enter a valid 10-digit Indian mobile number.");

  // Two independent buckets: one device can't request codes for many numbers,
  // and one number can't be bombarded with codes from many devices.
  for (const bucket of [`otp-ip:${clientIp(req)}`, `otp-phone:${phone}`]) {
    const limit = rateLimit(bucket);
    if (!limit.ok) {
      log.warn("otp_rate_limited");
      return fail(429, "Too many codes requested. Please wait a few minutes.", {
        "Retry-After": String(limit.retryAfterSec),
      });
    }
  }

  const { code, challenge, expiresAt } = issueOtp(phone);
  const stub = !smsEnabled();
  if (!stub) await sendSms(phone, `Your CivicResolve code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`);
  log.info("otp_issued", { stub });
  return NextResponse.json(
    { challenge, expiresAt, phone, stub, ...(stub ? { devCode: code } : {}) },
    { headers: NO_STORE_HEADERS },
  );
}
