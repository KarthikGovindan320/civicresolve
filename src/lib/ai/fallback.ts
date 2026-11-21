// =============================================================================
// Rule-based fallbacks used whenever Gemini is unavailable
// -----------------------------------------------------------------------------
// Deterministic and dependency-free, so a report is always classified and the
// app keeps working with no API key, no quota or no network. Tickets classified
// this way are flagged on the admin dashboard for human review.
// =============================================================================
import { CATEGORY_DEPARTMENT, type Category, type Classification } from "../types";

// Order matters: the most dangerous categories are matched first, so that a
// "sparking wire near a water pipe" is filed as an Electrical Hazard, not a leak.
const CATEGORY_KEYWORDS: [Category, RegExp][] = [
  ["Electrical Hazard", /wire|spark|electric|shock|transformer/i],
  ["Sewage/Drainage", /sewage|drain|manhole|gutter|sewer/i],
  ["Water Leakage", /water|leak|pipe|tap/i],
  ["Streetlight", /street\s*light|streetlight|lamp|dark|bulb/i],
  ["Garbage", /garbage|trash|waste|bin|dump|litter|rubbish/i],
  ["Pothole", /pothole|pot hole|crater/i],
  ["Road Damage", /road|footpath|pavement|slab|asphalt/i],
];

const TAMIL_SCRIPT = /[஀-௿]/;
const DEVANAGARI_SCRIPT = /[ऀ-ॿ]/;
const MAX_FALLBACK_TITLE_CHARS = 60;

/** Guess a language (ISO 639-1) from the script used: Tamil, Devanagari (Hindi), otherwise English. */
export function detectScriptLanguage(text: string): "ta" | "hi" | "en" {
  if (TAMIL_SCRIPT.test(text)) return "ta";
  return DEVANAGARI_SCRIPT.test(text) ? "hi" : "en";
}

/** Keyword classifier: always returns a valid category, department and language for any text. */
export function fallbackClassify(input: { title?: string; description?: string }): Classification {
  const text = `${input.title ?? ""} ${input.description ?? ""}`;
  const category = CATEGORY_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? "Other";
  return {
    title: (input.title || input.description || "Civic issue").slice(0, MAX_FALLBACK_TITLE_CHARS),
    category,
    priority: "Medium", // neutral default; safety rules in rules.ts can still force Critical
    priorityReason: "Auto-classified by keyword rules (AI unavailable); pending admin review.",
    department: CATEGORY_DEPARTMENT[category], // deterministic category → department routing
    englishSummary: input.description || input.title || "",
    detectedLanguage: detectScriptLanguage(text),
    transcript: null,
  };
}
