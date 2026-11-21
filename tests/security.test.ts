// [TESTING][SECURITY] Request-level protections (src/lib/security.ts, src/lib/auth.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAdmin } from "@/lib/auth";
import { isAllowedAudio, rateLimit, safeEqual, sniffImageType } from "@/lib/security";

const b64 = (bytes: number[] | string) =>
  Buffer.from(typeof bytes === "string" ? bytes : Uint8Array.from(bytes)).toString("base64");

describe("image signature sniffing", () => {
  it("recognises real image formats", () => {
    expect(sniffImageType(b64([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImageType(b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe("image/png");
    expect(sniffImageType(b64("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(b64("GIF89a"))).toBe("image/gif");
  });

  it("rejects HTML or scripts disguised as images", () => {
    expect(sniffImageType(b64("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImageType(b64("#!/bin/sh\nrm -rf /"))).toBeNull();
  });
});

describe("audio allow-list", () => {
  it("accepts browser recording formats and rejects others", () => {
    expect(isAllowedAudio("audio/webm;codecs=opus")).toBe(true);
    expect(isAllowedAudio("audio/mp4")).toBe(true);
    expect(isAllowedAudio("text/html")).toBe(false);
    expect(isAllowedAudio("application/javascript")).toBe(false);
  });
});

describe("rate limiter", () => {
  it("blocks a client after 10 requests in the window, then resets", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) expect(rateLimit("ip-test", t0).ok).toBe(true);
    const blocked = rateLimit("ip-test", t0);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(rateLimit("other-ip", t0).ok).toBe(true); // other clients unaffected
    expect(rateLimit("ip-test", t0 + 11 * 60_000).ok).toBe(true); // window expired
  });
});

describe("admin authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const req = (key?: string) => new Request("http://x", { headers: key ? { "x-admin-key": key } : {} });

  it("constant-time comparison is correct", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secreT")).toBe(false);
    expect(safeEqual("secret", "secret-longer")).toBe(false);
  });

  it("accepts the configured passcode and rejects anything else", () => {
    vi.stubEnv("ADMIN_PASSCODE", "s3cret");
    expect(isAdmin(req("s3cret"))).toBe(true);
    expect(isAdmin(req("wrong"))).toBe(false);
    expect(isAdmin(req())).toBe(false);
  });

  it("fails closed in production when no passcode is configured", () => {
    vi.stubEnv("ADMIN_PASSCODE", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(isAdmin(req("admin123"))).toBe(false);
  });
});
