// Unit tests for the stateless OTP scheme (lib/otp.ts).
import { describe, expect, it, vi } from "vitest";
import { OTP_TTL_MS, issueOtp, normalizePhone, verifyOtp } from "@/lib/otp";

describe("normalizePhone", () => {
  it("normalises the common ways people type an Indian mobile number", () => {
    for (const raw of ["9876543210", "+91 98765 43210", "+91-98765-43210", "919876543210", "09876543210"])
      expect(normalizePhone(raw)).toBe("+919876543210");
  });
  it("rejects landlines, short numbers and junk", () => {
    for (const raw of ["", "12345", "0416222333", "5876543210", "abcdefghij", "98765432101"])
      expect(normalizePhone(raw)).toBeNull();
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

describe("production safeguards", () => {
  const withEnv = async (env: Record<string, string | undefined>, check: () => Promise<void> | void) => {
    vi.resetModules();
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    try {
      await check();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  };

  it("refuses to sign anything in production without a configured secret", () =>
    withEnv({ NODE_ENV: "production", OTP_SECRET: "", LINK_SECRET: "" }, async () => {
      const { issueOtp: issue } = await import("@/lib/otp");
      expect(() => issue("+919876543210")).toThrow("OTP_SECRET or LINK_SECRET must be set in production.");
    }));

  it("shows demo codes in production only when explicitly switched on", () =>
    withEnv({ NODE_ENV: "production", SMS_PROVIDER: "", OTP_DEMO_CODES: "" }, async () => {
      const otp = await import("@/lib/otp");
      expect(otp.demoCodesAllowed()).toBe(false);
      vi.stubEnv("OTP_DEMO_CODES", "true");
      expect(otp.demoCodesAllowed()).toBe(true);
      vi.stubEnv("SMS_PROVIDER", "some-gateway");
      expect(otp.demoCodesAllowed()).toBe(false);
    }));

  it("answers 503 instead of issuing a code when neither SMS nor demo codes are available", () =>
    withEnv({ NODE_ENV: "production", SMS_PROVIDER: "", OTP_DEMO_CODES: "", LINK_SECRET: "test-secret" }, async () => {
      const { POST } = await import("@/app/api/otp/route");
      const response = await POST(
        new Request("http://t/api/otp", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" },
          body: JSON.stringify({ phone: "9876543210" }),
        }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).not.toHaveProperty("devCode");
    }));

  it("never pretends a text was sent while no SMS gateway is implemented", async () => {
    const { sendSms } = await import("@/lib/otp");
    await expect(sendSms("+919876543210", "hello")).rejects.toThrow("not implemented");
  });
});
