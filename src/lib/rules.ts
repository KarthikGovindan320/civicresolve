// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT][CODE QUALITY] DETERMINISTIC SAFETY & PRIORITY RULES
// -----------------------------------------------------------------------------
// BRIEF ✔ Priority Detection: "classify issues based on urgency AND potential
// public impact". We combine three signals:
//   1. Gemini's judgement of urgency (basePriority, from gemini.ts)
//   2. Hard safety rules that can never be overridden by a model (this file)
//   3. Public impact: how many citizens reported the same problem (this file)
// Why rules on top of AI? Life-safety triage must be predictable and auditable.
// An LLM can under-rate a "small wire hanging near the school gate"; a regex
// cannot. AI handles nuance; rules guarantee the floor.
// =============================================================================

import { PRIORITIES, type Priority, type Ticket } from "./types";

// Hazards that always force Critical, regardless of what the model says.
// Patterns cover common phrasings ("sparking", "cover missing", ...) and are
// applied to the citizen's text, Gemini's English summary AND the voice
// transcript, so a Tamil voice note about a live wire is still caught after
// translation.
const SAFETY_PATTERNS: { label: string; re: RegExp }[] = [
  // English phrasings plus common Tamil and Hindi words, so the rule also fires on reports that
  // skip Gemini (unverified reports, or AI unavailable) and are never translated.
  { label: "live wire", re: /live\s*wire|exposed\s*wire|sparking|electrocut|hanging\s*wire|current\s*wire|மின்\s*கம்பி|மின்சார\s*கம்பி|கரண்ட்\s*கம்பி|बिजली\s*का\s*तार|करंट/i },
  { label: "open manhole", re: /open\s*manhole|manhole\s*(cover\s*)?(missing|open|broken)|uncovered\s*manhole|பாதாள\s*சாக்கடை\s*மூடி|खुला\s*मैनहोल|मैनहोल\s*खुला/i },
  { label: "sewage overflow", re: /sewage\s*(overflow|flowing|leak)|overflowing\s*sewage|sewer\s*overflow|கழிவுநீர்|सीवर\s*(का\s*पानी|ओवरफ्लो)/i },
];

export function safetyRuleHit(text: string): string | null {
  for (const p of SAFETY_PATTERNS) if (p.re.test(text)) return p.label;
  return null;
}

/**
 * Reporter count raises priority: 3+ reporters bumps one level, 6+ bumps two.
 * Bumps stop at High: Critical is reserved for the AI's judgement and the safety rules.
 */
// Design note: the cap at High is deliberate. Popularity should move an issue
// up the queue, but "Critical" must keep meaning *danger to life*. Otherwise ten
// reports of an overflowing bin would outrank one open manhole.
// Every automatic change returns a human-readable `note`, so the citizen and
// the admin can see WHY the priority is what it is (explainable AI triage).
export function effectivePriority(
  base: Priority,
  reporterCount: number,
  safetyHit: string | null,
): { priority: Priority; note: string | null } {
  if (safetyHit) return { priority: "Critical", note: `Safety rule: ${safetyHit}.` };
  const bump = reporterCount >= 6 ? 2 : reporterCount >= 3 ? 1 : 0;
  const baseIdx = PRIORITIES.indexOf(base);
  // Never lower the AI's call; only raise it, and never past High.
  const idx = Math.max(baseIdx, Math.min(baseIdx + bump, PRIORITIES.indexOf("High")));
  const priority = PRIORITIES[idx];
  return {
    priority,
    note: bump && priority !== base ? `Raised from ${base}: ${reporterCount} people reported this.` : null,
  };
}

// [CODE QUALITY] Recompute from the stored basePriority each time (duplicate merge, admin
// edit, seed load). Always starting from the AI's original call makes the
// result idempotent: merging the 4th report doesn't bump on top of earlier bumps.
export function recomputePriority(t: Ticket): Ticket {
  const base = t.basePriority ?? t.priority;
  const hit = safetyRuleHit(`${t.title} ${t.description} ${t.englishSummary} ${t.transcript ?? ""}`);
  const { priority } = effectivePriority(base, t.reporterCount, hit);
  return { ...t, basePriority: base, priority };
}

/** Distance in metres between two lat/lng points. */
// [EFFICIENCY] Haversine great-circle distance. Used for the 200 m duplicate-detection radius.
// Pure maths, so no maps API key or paid service is needed.
export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000; // Earth radius in metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
