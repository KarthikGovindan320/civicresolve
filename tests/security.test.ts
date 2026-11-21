// Request-level protections (src/lib/security.ts, src/lib/auth.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_FAILED_SIGN_INS, authenticateStaff, isAdminRole, roleForPasscode } from "@/lib/auth";
import { clientIp, peekRateLimit, rateLimit, safeEqual, sniffAudioType, sniffImageType } from "@/lib/security";

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
  it("honours a per-budget window length", () => {
    const t0 = 2_000_000;
    const short = { max: 1, windowMs: 60_000 };
    expect(rateLimit("short-window", { ...short, now: t0 }).ok).toBe(true);
    const blocked = rateLimit("short-window", { ...short, now: t0 });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
    expect(rateLimit("short-window", { ...short, now: t0 + 60_001 }).ok).toBe(true);
  });

  it("blocks a client after 10 requests in the window, then resets", () => {
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) expect(rateLimit("ip-test", { now }).ok).toBe(true);
    const blocked = rateLimit("ip-test", { now });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(600); // the whole 10-minute window is still ahead
    expect(rateLimit("other-ip", { now }).ok).toBe(true); // other clients unaffected
    expect(rateLimit("ip-test", { now: now + 11 * 60_000 }).ok).toBe(true); // window expired
  });

  it("takes a per-endpoint budget size", () => {
    const now = 2_000_000;
    expect(rateLimit("small-budget", { max: 1, now }).ok).toBe(true);
    expect(rateLimit("small-budget", { max: 1, now }).ok).toBe(false);
  });

  it("can check a budget without spending it", () => {
    const now = 3_000_000;
    expect(peekRateLimit("peeked", { max: 2, now }).ok).toBe(true); // nothing counted yet
    rateLimit("peeked", { max: 2, now });
    expect(peekRateLimit("peeked", { max: 2, now }).ok).toBe(true);
    rateLimit("peeked", { max: 2, now });
    expect(peekRateLimit("peeked", { max: 2, now })).toEqual({ ok: false, retryAfterSec: 600 });
    expect(peekRateLimit("peeked", { max: 2, now: now + 11 * 60_000 }).ok).toBe(true);
  });
});

describe("staff authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  let ip = 0;
  const req = (key?: string, from = `198.51.100.${++ip}`) =>
    new Request("http://x", { headers: { "x-forwarded-for": from, ...(key ? { "x-staff-key": key } : {}) } });
  const roleOf = (request: Request) => {
    const auth = authenticateStaff(request);
    return auth.ok ? auth.role : null;
  };

  it("constant-time comparison is correct", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secreT")).toBe(false);
    expect(safeEqual("secret", "secret-longer")).toBe(false);
  });

  it("accepts the configured passcode and rejects anything else", () => {
    vi.stubEnv("ADMIN_PASSCODE", "s3cret");
    expect(isAdminRole(roleOf(req("s3cret")))).toBe(true);
    expect(roleOf(req("wrong"))).toBeNull();
    expect(roleOf(req())).toBeNull();
  });

  it("ignores the old x-admin-key header", () => {
    vi.stubEnv("ADMIN_PASSCODE", "s3cret");
    expect(roleOf(new Request("http://x", { headers: { "x-admin-key": "s3cret" } }))).toBeNull();
  });

  it("fails closed in production when no passcode is configured", () => {
    vi.stubEnv("ADMIN_PASSCODE", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(roleForPasscode("admin123")).toBeNull();
  });

  it("locks out a client that keeps guessing, even once it sends the right passcode", () => {
    vi.stubEnv("ADMIN_PASSCODE", "s3cret");
    const guesser = "203.0.113.200";
    for (let i = 0; i < MAX_FAILED_SIGN_INS; i++) expect(authenticateStaff(req(`guess-${i}`, guesser)).ok).toBe(true);
    const locked = authenticateStaff(req("s3cret", guesser));
    expect(locked).toMatchObject({ ok: false, status: 429 });
    expect(locked.ok ? 0 : locked.retryAfterSec).toBeGreaterThan(0);
    // Requests without a passcode are not affected, and nor is anyone else.
    expect(authenticateStaff(req(undefined, guesser))).toEqual({ ok: true, role: null });
    expect(roleOf(req("s3cret"))).toEqual({ role: "admin" });
  });

  it("never counts the right passcode as a failed attempt", () => {
    vi.stubEnv("ADMIN_PASSCODE", "s3cret");
    const staffDesk = "203.0.113.201";
    for (let i = 0; i < MAX_FAILED_SIGN_INS * 2; i++)
      expect(roleOf(req("s3cret", staffDesk))).toEqual({ role: "admin" });
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
