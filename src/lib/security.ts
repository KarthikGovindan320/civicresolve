// =============================================================================
// Request-level protections used by the API routes
// -----------------------------------------------------------------------------
//   • rateLimit()      → stops one client from flooding the report endpoint
//                        (protects the database and the Gemini quota/cost).
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

// Fixed-window rate limiter held in memory. It is per instance, which is enough
// for a prototype on Cloud Run (each instance protects itself); a shared store
// such as Memorystore would make it global.
const WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 10 * 60_000);
const MAX_HITS = Number(process.env.RATE_MAX || 10);
/** Above this many tracked keys, expired windows are swept so the map cannot grow without bound. */
const MAX_TRACKED_KEYS = 10_000;
/** A file signature fits in the first 18 bytes, which is 24 base64 characters. */
const SIGNATURE_BASE64_CHARS = 24;

const hitsByKey = new Map<string, { count: number; resetAt: number }>();

function sweepExpiredWindows(now: number) {
  for (const [key, entry] of hitsByKey) if (entry.resetAt <= now) hitsByKey.delete(key);
}

/** Count one request against `key`; `ok` turns false once `max` is exceeded within the current window. */
export function rateLimit(key: string, now = Date.now(), max = MAX_HITS): { ok: boolean; retryAfterSec: number } {
  const entry = hitsByKey.get(key);
  if (!entry || entry.resetAt <= now) {
    hitsByKey.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (hitsByKey.size > MAX_TRACKED_KEYS) sweepExpiredWindows(now);
    return { ok: true, retryAfterSec: 0 };
  }
  entry.count += 1;
  return entry.count > max
    ? { ok: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) }
    : { ok: true, retryAfterSec: 0 };
}

/** The caller's IP address as reported by Cloud Run's front end, or "local" when there is no proxy. */
export function clientIp(req: Request): string {
  // Use the rightmost X-Forwarded-For entry: it is the one appended by Cloud Run's
  // Google Front End and cannot be forged. Entries to its left come from the client, so
  // taking the first one would let anyone dodge the rate limiter by sending a fake header.
  const hops = req.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops?.at(-1) || "local";
}

/** Constant-time string comparison: the time taken doesn't reveal how many leading characters matched. */
export function safeEqual(given: string, expected: string): boolean {
  const givenBytes = Buffer.from(given);
  const expectedBytes = Buffer.from(expected);
  if (givenBytes.length !== expectedBytes.length) {
    timingSafeEqual(expectedBytes, expectedBytes); // keep timing uniform even when lengths differ
    return false;
  }
  return timingSafeEqual(givenBytes, expectedBytes);
}

function signatureBytes(base64: string): Buffer {
  return Buffer.from(base64.slice(0, SIGNATURE_BASE64_CHARS), "base64");
}

/**
 * Identify an image by its first bytes, never by the client's claim. Only
 * formats that Gemini and browsers both handle are allowed.
 */
export function sniffImageType(base64: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" | null {
  const header = signatureBytes(base64);
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) return "image/png";
  if (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (header.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return null;
}

/** Recording formats forwarded to Gemini, each recognised by its first bytes. */
const AUDIO_SIGNATURES: { mimeType: string; matches: (header: Buffer) => boolean }[] = [
  // WebM / Matroska (Chrome, Firefox)
  { mimeType: "audio/webm", matches: (h) => h.readUInt32BE(0) === 0x1a45dfa3 },
  // Ogg / Opus
  { mimeType: "audio/ogg", matches: (h) => h.toString("ascii", 0, 4) === "OggS" },
  // MP4 / M4A (Safari, Android)
  { mimeType: "audio/mp4", matches: (h) => h.toString("ascii", 4, 8) === "ftyp" },
  {
    mimeType: "audio/wav",
    matches: (h) => h.toString("ascii", 0, 4) === "RIFF" && h.toString("ascii", 8, 12) === "WAVE",
  },
  { mimeType: "audio/flac", matches: (h) => h.toString("ascii", 0, 4) === "fLaC" },
  // ADTS AAC: frame sync with layer bits 00
  { mimeType: "audio/aac", matches: (h) => h[0] === 0xff && (h[1] & 0xf6) === 0xf0 },
  // MP3: an ID3 tag, or a bare MPEG audio frame sync
  {
    mimeType: "audio/mpeg",
    matches: (h) => h.toString("ascii", 0, 3) === "ID3" || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0),
  },
];

/**
 * Like images, audio is identified by its first bytes and never by the browser's
 * claim, so a renamed file of another type is never forwarded to Gemini, and the
 * type stored with the recording is the one its contents prove.
 */
export function sniffAudioType(base64: string): string | null {
  const header = signatureBytes(base64);
  if (header.length < 12) return null;
  return AUDIO_SIGNATURES.find((signature) => signature.matches(header))?.mimeType ?? null;
}
