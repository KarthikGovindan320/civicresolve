import type { MediaPart } from "./gemini";
import { isAllowedAudio, sniffImageType } from "./security";

// [SECURITY][CODE QUALITY] One place for upload handling, shared by every route
// that accepts files (new reports, "after" photos, reopen photos), so size caps
// and content checks can't differ between endpoints.

// [GOOGLE SERVICES] Images are stored base64-encoded in a Firestore document (1 MiB limit). 700 KB raw
// becomes ~933 KB encoded, so even the largest allowed photo fits. Browsers downscale to ~150 KB anyway.
export const MAX_IMAGE = 700_000; // bytes, after client-side downscale
export const MAX_AUDIO = 4_000_000; // about 60 s of compressed voice

export type UploadResult = { ok: true; part: MediaPart | null } | { ok: false; error: string; status: number };

async function read(f: FormDataEntryValue | null, max: number): Promise<MediaPart | null | "too-big"> {
  if (!f || typeof f === "string" || f.size === 0) return null;
  if (f.size > max) return "too-big";
  return { mimeType: f.type || "application/octet-stream", data: Buffer.from(await f.arrayBuffer()).toString("base64") };
}

// [SECURITY] Images: the real type comes from the file signature (magic bytes);
// the client's MIME claim is discarded.
export async function readImage(f: FormDataEntryValue | null): Promise<UploadResult> {
  const p = await read(f, MAX_IMAGE);
  if (p === "too-big") return { ok: false, error: "Image is too large.", status: 413 };
  if (!p) return { ok: true, part: null };
  const real = sniffImageType(p.data);
  if (!real) return { ok: false, error: "Attachment must be a JPEG, PNG, WebP or GIF image.", status: 400 };
  return { ok: true, part: { ...p, mimeType: real } };
}

// [SECURITY] Audio: only an allow-list of recording formats is forwarded to Gemini.
export async function readAudio(f: FormDataEntryValue | null): Promise<UploadResult> {
  const p = await read(f, MAX_AUDIO);
  if (p === "too-big") return { ok: false, error: "Voice note is too long.", status: 413 };
  if (!p) return { ok: true, part: null };
  if (!isAllowedAudio(p.mimeType)) return { ok: false, error: "Voice note must be an audio recording.", status: 400 };
  return { ok: true, part: p };
}

// Simple, permissive email check: one @, a dot in the domain, no spaces, max length.
export function parseEmail(raw: string): string | null | "invalid" {
  const e = raw.trim().toLowerCase();
  if (!e) return null;
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "invalid";
}
