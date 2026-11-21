// =============================================================================
// [SECURITY] Request-level protections used by the API routes
// -----------------------------------------------------------------------------
//   • rateLimit()      → stops one client from flooding the report endpoint
//                        (protects the database AND the Gemini quota/cost).
//   • safeEqual()      → constant-time secret comparison (no timing attacks
//                        on the admin passcode).
//   • sniffImageType() → checks an upload's real file signature ("magic bytes"),
//                        so a script renamed to .jpg is rejected even if the
//                        browser claims image/jpeg.
//   • clientIp()       → reads the client IP the way Google Cloud Run's front
//                        end reports it (X-Forwarded-For).
// Covered by tests/security.test.ts.
// =============================================================================

import { timingSafeEqual } from "crypto";

// [SECURITY][EFFICIENCY] Fixed-window rate limiter held in memory. It is per
// instance, which is enough for a prototype on Cloud Run (each instance
// protects itself); a shared store such as Memorystore would make it global.
const WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 10 * 60_000);
const MAX_HITS = Number(process.env.RATE_MAX || 10);
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, now = Date.now(), max = MAX_HITS): { ok: boolean; retryAfterSec: number } {
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    // [EFFICIENCY] Opportunistic cleanup so the map can't grow without bound.
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    return { ok: true, retryAfterSec: 0 };
  }
  entry.count += 1;
  return entry.count > max
    ? { ok: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) }
    : { ok: true, retryAfterSec: 0 };
}

export function clientIp(req: Request): string {
  // [SECURITY] Use the RIGHTMOST X-Forwarded-For entry: it is the one appended by Cloud Run's
  // Google Front End and cannot be forged. Entries to its left come from the client, so
  // taking the first one would let anyone dodge the rate limiter by sending a fake header.
  const hops = req.headers.get("x-forwarded-for")?.split(",").map((h) => h.trim()).filter(Boolean);
  return hops?.at(-1) || "local";
}

// [SECURITY] Constant-time comparison: the time taken doesn't reveal how many
// leading characters of a guess were correct.
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(bb, bb); // keep timing uniform even when lengths differ
    return false;
  }
  return timingSafeEqual(ba, bb);
}

// [SECURITY] Identify an image by its first bytes, never by the client's claim.
// Only formats Gemini and browsers both handle are allowed.
export function sniffImageType(b64: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" | null {
  const h = Buffer.from(b64.slice(0, 24), "base64");
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return "image/jpeg";
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return "image/png";
  if (h.toString("ascii", 0, 4) === "RIFF" && h.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (h.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return null;
}

// [SECURITY] Voice notes: only audio MIME types are forwarded to Gemini.
export function isAllowedAudio(mime: string): boolean {
  return /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|m4a|x-m4a|flac)$/.test(mime.split(";")[0]);
}

// [SECURITY] Like images, audio is checked by its first bytes, not only by the browser's claim,
// so a renamed file of another type is never forwarded to Gemini.
export function looksLikeAudio(b64: string): boolean {
  const h = Buffer.from(b64.slice(0, 24), "base64");
  const ascii = (a: number, b: number) => h.toString("ascii", a, b);
  return (
    (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) || // WebM / Matroska (Chrome, Firefox)
    ascii(0, 4) === "OggS" || // Ogg / Opus
    ascii(4, 8) === "ftyp" || // MP4 / M4A / AAC in MP4 (Safari)
    (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") || // WAV
    ascii(0, 3) === "ID3" || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) || // MP3 / ADTS AAC
    ascii(0, 4) === "fLaC" // FLAC
  );
}
