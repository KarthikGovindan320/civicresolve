// Request-level protections (src/lib/security.ts, src/lib/auth.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAdmin } from "@/lib/auth";
import { clientIp, rateLimit, safeEqual, sniffAudioType, sniffImageType } from "@/lib/security";

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

// Hardening added after the final self-review.
describe("hardening", () => {
  it("rate-limits by the proxy-appended (rightmost) IP, so a forged X-Forwarded-For can't dodge it", () => {
    const req = new Request("http://t", { headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" } });
    expect(clientIp(req)).toBe("203.0.113.9");
    expect(clientIp(new Request("http://t"))).toBe("local");
  });
  it("types audio by its signature and rejects other files labelled as audio", () => {
    const b64 = (bytes: number[]) => Buffer.from([...bytes, ...new Array(16).fill(0)]).toString("base64");
    const text = (value: string) => b64([...Buffer.from(value)]);
    expect(sniffAudioType(b64([0x1a, 0x45, 0xdf, 0xa3]))).toBe("audio/webm");
    expect(sniffAudioType(text("OggS"))).toBe("audio/ogg");
    expect(sniffAudioType(text("\0\0\0\x20ftypM4A "))).toBe("audio/mp4");
    expect(sniffAudioType(text("RIFF\0\0\0\0WAVE"))).toBe("audio/wav");
    expect(sniffAudioType(text("fLaC"))).toBe("audio/flac");
    expect(sniffAudioType(text("ID3"))).toBe("audio/mpeg");
    expect(sniffAudioType(b64([0xff, 0xfb]))).toBe("audio/mpeg");
    expect(sniffAudioType(b64([0xff, 0xf1]))).toBe("audio/aac");
    expect(sniffAudioType(text("%PDF-1.7 hello"))).toBeNull();
    expect(sniffAudioType(b64([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // PNG
    expect(sniffAudioType(Buffer.from("OggS").toString("base64"))).toBeNull(); // too short to be a recording
  });
});
