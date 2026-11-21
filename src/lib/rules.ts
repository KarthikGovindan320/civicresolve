// =============================================================================
// Deterministic safety and priority rules
// -----------------------------------------------------------------------------
// The brief asks for priority based on "urgency and potential public impact".
// We combine three signals:
//   1. Gemini's judgement of urgency (basePriority, from gemini.ts)
//   2. Hard safety rules that can never be overridden by a model (this file)
//   3. Public impact: how many citizens reported the same problem (this file)
// Why rules on top of AI? Life-safety triage must be predictable and auditable.
// An LLM can under-rate a "small wire hanging near the school gate"; a regex
// cannot. AI handles nuance; rules guarantee the floor.
// =============================================================================

import { PRIORITIES, type Priority, type Ticket } from "./types";

// Hazards that always force Critical, regardless of what the model says. They
// are applied to the citizen's text, Gemini's English summary and the voice
// transcript, so a Tamil voice note about a live wire is still caught after
// translation. The patterns also include common Tamil and Hindi words, so the
// rule fires on reports that skip Gemini (unverified, or AI unavailable) and
// are never translated.
const SAFETY_PATTERNS: { label: string; pattern: RegExp }[] = [
  {
    label: "live wire",
    pattern:
      /live\s*wire|exposed\s*wire|sparking|electrocut|hanging\s*wire|current\s*wire|மின்\s*கம்பி|மின்சார\s*கம்பி|கரண்ட்\s*கம்பி|बिजली\s*का\s*तार|करंट/i,
  },
  {
    label: "open manhole",
    pattern:
      /open\s*manhole|manhole\s*(cover\s*)?(missing|open|broken)|uncovered\s*manhole|பாதாள\s*சாக்கடை\s*மூடி|खुला\s*मैनहोल|मैनहोल\s*खुला/i,
  },
  {
    label: "sewage overflow",
    pattern:
      /sewage\s*(overflow|flowing|leak)|overflowing\s*sewage|sewer\s*overflow|கழிவுநீர்|सीवर\s*(का\s*पानी|ओवरफ्लो)/i,
  },
];

/** Reporter counts at which public impact raises the priority by one and by two levels. */
const ONE_LEVEL_BUMP_REPORTERS = 3;
const TWO_LEVEL_BUMP_REPORTERS = 6;
/** Popularity can raise a ticket this far and no further; Critical is reserved for danger to life. */
const REPORTER_BUMP_CEILING: Priority = "High";

const EARTH_RADIUS_M = 6_371_000;

/** The label of the first life-safety hazard mentioned in `text`, or null. */
export function safetyRuleHit(text: string): string | null {
  for (const rule of SAFETY_PATTERNS) if (rule.pattern.test(text)) return rule.label;
  return null;
}

/** All the text of a ticket that the safety rules scan: the citizen's words, the English summary and the transcript. */
export function safetyScanText(fields: {
  title: string;
  description: string;
  englishSummary: string;
  transcript?: string | null;
}): string {
  return `${fields.title} ${fields.description} ${fields.englishSummary} ${fields.transcript ?? ""}`;
}

/**
 * Reporter count raises priority: 3+ reporters bumps one level, 6+ bumps two.
 * Bumps stop at High: popularity should move an issue up the queue, but
 * "Critical" must keep meaning danger to life, otherwise ten reports of an
 * overflowing bin would outrank one open manhole. Every automatic change
 * returns a human-readable `note`, so the citizen and the admin can see why
 * the priority is what it is.
 */
export function effectivePriority(
  base: Priority,
  reporterCount: number,
  safetyHit: string | null,
): { priority: Priority; note: string | null } {
  if (safetyHit) return { priority: "Critical", note: `Safety rule: ${safetyHit}.` };
  const bump = reporterCount >= TWO_LEVEL_BUMP_REPORTERS ? 2 : reporterCount >= ONE_LEVEL_BUMP_REPORTERS ? 1 : 0;
  const baseIndex = PRIORITIES.indexOf(base);
  // Never lower the AI's call; only raise it, and never past the ceiling.
  const bumpedIndex = Math.max(baseIndex, Math.min(baseIndex + bump, PRIORITIES.indexOf(REPORTER_BUMP_CEILING)));
  const priority = PRIORITIES[bumpedIndex];
  return {
    priority,
    note: bump && priority !== base ? `Raised from ${base}: ${reporterCount} people reported this.` : null,
  };
}

/**
 * Recompute a ticket's priority from its stored basePriority (after a duplicate
 * merge, a staff edit or a seed load). Always starting from the AI's original
 * call makes the result idempotent: merging the 4th report doesn't bump on top
 * of earlier bumps.
 */
export function recomputePriority(ticket: Ticket): Ticket {
  const base = ticket.basePriority ?? ticket.priority;
  const { priority } = effectivePriority(base, ticket.reporterCount, safetyRuleHit(safetyScanText(ticket)));
  return { ...ticket, basePriority: base, priority };
}

/**
 * Great-circle distance in metres between two lat/lng points. Used for the
 * duplicate-detection radius; pure maths, so no maps API or paid service is needed.
 */
export function haversine(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latDelta = toRadians(to.lat - from.lat);
  const lngDelta = toRadians(to.lng - from.lng);
  const chordSquared =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(lngDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(chordSquared));
}
