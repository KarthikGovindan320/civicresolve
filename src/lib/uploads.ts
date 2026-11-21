import type { MediaPart } from "./gemini";
import { failure, type Result } from "./result";
import { sniffAudioType, sniffImageType } from "./security";
import { LIMITS } from "./types";

// One place for upload handling, shared by every route that accepts files (new
// reports, "after" photos, reopen photos), so size caps and content checks
// can't differ between endpoints.

// Images are stored base64-encoded in a Firestore document (1 MiB limit). 700 KB raw
// becomes ~933 KB encoded, so even the largest allowed photo fits. Browsers downscale
// to ~150 KB anyway.
/** Largest accepted photo, in bytes (after the browser's own downscale). */
export const MAX_IMAGE = 700_000;
/** Largest accepted voice note, in bytes: about 60 s of compressed speech. */
export const MAX_AUDIO = 4_000_000;

const UNKNOWN_MIME_TYPE = "application/octet-stream";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A validated upload (`part` is null when no file was attached), or the reason it was refused. */
export type UploadResult = Result<{ part: MediaPart | null }>;

async function readFile(entry: FormDataEntryValue | null, maxBytes: number): Promise<MediaPart | null | "too-big"> {
  if (!entry || typeof entry === "string" || entry.size === 0) return null;
  if (entry.size > maxBytes) return "too-big";
  return {
    mimeType: entry.type || UNKNOWN_MIME_TYPE,
    data: Buffer.from(await entry.arrayBuffer()).toString("base64"),
  };
}

/**
 * Read an optional image upload. The real type comes from the file signature
 * (magic bytes); the client's MIME claim is discarded.
 */
export async function readImage(entry: FormDataEntryValue | null): Promise<UploadResult> {
  const file = await readFile(entry, MAX_IMAGE);
  if (file === "too-big") return failure(413, "Image is too large.");
  if (!file) return { ok: true, part: null };
  const sniffedType = sniffImageType(file.data);
  if (!sniffedType) return failure(400, "Attachment must be a JPEG, PNG, WebP or GIF image.");
  return { ok: true, part: { ...file, mimeType: sniffedType } };
}

/**
 * Read an optional voice note. Only an allow-list of recording formats is
 * forwarded to Gemini, typed by their file signature like images are.
 */
export async function readAudio(entry: FormDataEntryValue | null): Promise<UploadResult> {
  const file = await readFile(entry, MAX_AUDIO);
  if (file === "too-big") return failure(413, "Voice note is too long.");
  if (!file) return { ok: true, part: null };
  const sniffedType = sniffAudioType(file.data);
  if (!sniffedType) return failure(400, "Voice note must be an audio recording.");
  return { ok: true, part: { ...file, mimeType: sniffedType } };
}

/**
 * Parse an optional email: null when blank, "invalid" when it doesn't look like
 * one. Deliberately permissive: one @, a dot in the domain, no spaces, max length.
 */
export function parseEmail(raw: string): string | null | "invalid" {
  const email = raw.trim().toLowerCase();
  if (!email) return null;
  return email.length <= LIMITS.email && EMAIL_PATTERN.test(email) ? email : "invalid";
}
