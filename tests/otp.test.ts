// [TESTING][SECURITY] Unit tests for the stateless OTP scheme (lib/otp.ts).
import { describe, expect, it } from "vitest";
import { OTP_TTL_MS, issueOtp, normalizePhone, verifyOtp } from "@/lib/otp";

describe("normalizePhone", () => {
  it("normalises the common ways people type an Indian mobile number", () => {
    for (const raw of ["9876543210", "+91 98765 43210", "+91-98765-43210", "919876543210", "09876543210"])
      expect(normalizePhone(raw)).toBe("+919876543210");
  });
  it("rejects landlines, short numbers and junk", () => {
    for (const raw of ["", "12345", "0416222333", "5876543210", "abcdefghij", "98765432101"]) expect(normalizePhone(raw)).toBeNull();
  });
});

describe("issueOtp / verifyOtp", () => {
  const phone = "+919876543210";
  it("verifies the issued code for the same number only", () => {
    const { code, challenge } = issueOtp(phone);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyOtp(phone, code, challenge)).toBe(true);
    expect(verifyOtp("+919876543211", code, challenge)).toBe(false);
    expect(verifyOtp(phone, code === "123456" ? "654321" : "123456", challenge)).toBe(false);
  });
  it("expires after the time limit and rejects tampered expiry times", () => {
    const now = Date.now();
    const { code, challenge } = issueOtp(phone, now);
    expect(verifyOtp(phone, code, challenge, now + OTP_TTL_MS + 1)).toBe(false);
    const [, mac] = challenge.split(".");
    expect(verifyOtp(phone, code, `${now + OTP_TTL_MS * 10}.${mac}`, now)).toBe(false);
  });
});
