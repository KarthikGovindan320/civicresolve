// =============================================================================
// [SECURITY] POST /api/otp: send a one-time code to the citizen's phone (anti-spam)
// -----------------------------------------------------------------------------
// Body: { phone }. Returns { challenge, expiresAt, phone (normalised), stub }, plus, in stub
// mode only (no SMS gateway yet), { devCode } so the demo can show "use this code".
// Rate-limited per IP AND per phone number, so it can't be used to spam someone's phone.
// The phone number is never written to logs.
// =============================================================================
import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { issueOtp, normalizePhone, sendSms, smsEnabled } from "@/lib/otp";
import { clientIp, rateLimit } from "@/lib/security";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { phone?: unknown };
  const phone = normalizePhone(String(body.phone ?? ""));
  if (!phone) return NextResponse.json({ error: "Enter a valid 10-digit Indian mobile number." }, { status: 400 });

  // [SECURITY] Two independent buckets: one device can't request codes for many numbers,
  // and one number can't be bombarded with codes from many devices.
  for (const key of [`otp-ip:${clientIp(req)}`, `otp-phone:${phone}`]) {
    const limit = rateLimit(key);
    if (!limit.ok) {
      log.warn("otp_rate_limited");
      return NextResponse.json(
        { error: "Too many codes requested. Please wait a few minutes." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }
  }

  const { code, challenge, expiresAt } = issueOtp(phone);
  const stub = !smsEnabled();
  if (!stub) await sendSms(phone, `Your CivicResolve code is ${code}. It expires in 5 minutes.`);
  log.info("otp_issued", { stub });
  return NextResponse.json(
    { challenge, expiresAt, phone, stub, ...(stub ? { devCode: code } : {}) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
