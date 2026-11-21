// =============================================================================
// Gemini integration: the AI features of CivicResolve
// -----------------------------------------------------------------------------
// Requirements from the problem statement implemented here:
//   • AI-powered classification  → classifyIssue() returns `category`
//   • Priority detection         → classifyIssue() returns `priority` + `priorityReason`
//   • Department recommendation  → classifyIssue() returns `department`
// Additions:
//   • Multimodal input: text, photo and voice note go to Gemini in one request, so
//     the model can cross-check the evidence (e.g. a photo of a sparking wire
//     overrides a vague text description).
//   • Multilingual: citizens can write or speak Tamil, Hindi, English or a mix;
//     Gemini returns an English summary for officials plus a verbatim transcript.
//   • Duplicate detection, message translation and proof-of-fix verification.
//   • Resilience: every feature returns a usable answer when the AI is slow,
//     wrong or unavailable, so the citizen is never left with a spinning button.
// Layout: ai/client.ts makes the calls (model chain, timeouts), ai/prompts.ts
// holds the prompts and answer schemas, ai/fallback.ts the rule-based fallbacks.
// =============================================================================

import type { Part } from "@google/genai";
import { FAST_MODELS, generateJson, geminiEnabled, type MediaPart } from "./ai/client";
import { detectScriptLanguage, fallbackClassify } from "./ai/fallback";
import {
  CLASSIFICATION_JSON_SCHEMA,
  ClassificationSchema,
  DuplicateSchema,
  TRANSLATION_JSON_SCHEMA,
  TranslationSchema,
  TRANSLATION_SYSTEM_PROMPT,
  TRIAGE_SYSTEM_PROMPT,
  VERIFICATION_JSON_SCHEMA,
  VerificationSchema,
  classificationPrompt,
  duplicateJsonSchema,
  duplicatePrompt,
  translationPrompt,
  verificationPrompt,
  type DuplicateCandidate,
} from "./ai/prompts";
import { describeError, log } from "./log";
import type { AiVerdict, Category, Classification } from "./types";

export { geminiEnabled, type MediaPart } from "./ai/client";
export { fallbackClassify } from "./ai/fallback";

/** Low temperatures keep triage consistent and repeatable; yes/no judgements use zero. */
const CLASSIFICATION_TEMPERATURE = 0.2;
const TRANSLATION_TEMPERATURE = 0.1;
const JUDGEMENT_TEMPERATURE = 0;

/** Without AI, two reports of one category count as the same problem only when this close. */
const RULE_BASED_DUPLICATE_RADIUS_M = 50;
/** Caps on model-written text before it is stored. */
const MAX_AI_REASON_CHARS = 300;
const MAX_LANGUAGE_CODE_CHARS = 8;
const MAX_TRANSLATION_CHARS = 2000;

/** Shown when the proof-of-fix check could not give a verdict; the citizen still decides. */
const UNVERIFIED_FIX_REASON = "AI check failed; awaiting citizen confirmation.";

const ASCII_ONLY = /^[\x00-\x7F]*$/;

const inlineMedia = (media: MediaPart): Part => ({ inlineData: media });

/**
 * Classify a report: category, priority and department in one multimodal call,
 * plus language detection, an English summary and a voice transcript. A single
 * round trip keeps the citizen's wait short and API usage low. Never throws:
 * on any failure the keyword classifier answers instead (source "fallback").
 */
export async function classifyIssue(input: {
  title?: string;
  description?: string;
  address?: string;
  image?: MediaPart | null;
  audio?: MediaPart | null;
}): Promise<{ result: Classification; source: "gemini" | "fallback"; error?: string }> {
  if (!geminiEnabled()) return { result: fallbackClassify(input), source: "fallback", error: "GEMINI_API_KEY not set" };
  try {
    const prompt = classificationPrompt({ ...input, hasImage: Boolean(input.image), hasAudio: Boolean(input.audio) });
    // Multimodal evidence: photo and voice note travel inline in the same request.
    const parts: Part[] = [{ text: prompt }];
    if (input.image) parts.push(inlineMedia(input.image));
    if (input.audio) parts.push(inlineMedia(input.audio));

    const { json } = await generateJson(parts, {
      systemInstruction: TRIAGE_SYSTEM_PROMPT,
      responseJsonSchema: CLASSIFICATION_JSON_SCHEMA,
      temperature: CLASSIFICATION_TEMPERATURE,
    });
    const parsed = ClassificationSchema.safeParse(json);
    if (parsed.success) return { result: parsed.data, source: "gemini" };
    // The model answered but broke the contract: fall back instead of storing bad data.
    return { result: fallbackClassify(input), source: "fallback", error: "schema mismatch" };
  } catch (error) {
    // Network error, quota, overload or timeout: the report is still accepted.
    return { result: fallbackClassify(input), source: "fallback", error: describeError(error) };
  }
}

/**
 * Decide whether a new report is the same physical problem as a nearby open
 * ticket. Geography narrows the field cheaply first (same category, open,
 * within the duplicate radius; see services/report.ts); Gemini then makes the
 * semantic call: the same pothole, or just another one on the same street?
 * Merging duplicates keeps the queues clean and turns repeat reports into a
 * public-impact signal (reporterCount → priority boost, see rules.ts).
 */
export async function findDuplicate(
  incoming: { summary: string; category: Category; image?: MediaPart | null },
  candidates: DuplicateCandidate[],
): Promise<{ id: string | null; reason: string }> {
  if (!candidates.length) return { id: null, reason: "No nearby open tickets." };
  if (!geminiEnabled()) {
    const nearest = candidates.find((candidate) => candidate.distance < RULE_BASED_DUPLICATE_RADIUS_M);
    return nearest
      ? { id: nearest.id, reason: `Same category within ${Math.round(nearest.distance)} m (rule-based).` }
      : { id: null, reason: "No close match (rule-based)." };
  }
  try {
    const candidateIds = candidates.map((candidate) => candidate.id);
    const parts: Part[] = [{ text: duplicatePrompt(incoming, candidates) }];
    if (incoming.image) parts.push(inlineMedia(incoming.image));
    const { json } = await generateJson(
      parts,
      { responseJsonSchema: duplicateJsonSchema(candidateIds), temperature: JUDGEMENT_TEMPERATURE },
      FAST_MODELS,
    );
    // Validate the model's answer like any other untrusted input: schema-check it,
    // then accept the id only if it is one of the real candidates.
    const answer = DuplicateSchema.safeParse(json);
    if (!answer.success) return { id: null, reason: "No confident match." };
    const { duplicateOf, reason } = answer.data;
    const id = duplicateOf !== null && candidateIds.includes(duplicateOf) ? duplicateOf : null;
    return { id, reason: reason.slice(0, MAX_AI_REASON_CHARS) };
  } catch (error) {
    // If the check fails we create a new ticket: a possible duplicate is far better than a
    // lost report. The internal error is logged, never shown to the citizen.
    log.warn("duplicate_check_failed", { error: describeError(error) });
    return { id: null, reason: "Duplicate check unavailable." };
  }
}

/**
 * Translate a department ↔ citizen message. Officials write in English; a
 * citizen who reported in Tamil reads the reply in Tamil, and their Tamil reply
 * reaches the official in English. `translation` is null when none is needed or
 * the AI is unavailable: the original text is always kept, so a message is never lost.
 */
export async function translateMessage(
  text: string,
  targetLanguage: string,
): Promise<{ detectedLanguage: string; translation: string | null }> {
  const scriptLanguage = detectScriptLanguage(text);
  if (!geminiEnabled()) return { detectedLanguage: scriptLanguage, translation: null };
  // Plain-ASCII text going to an English reader needs no AI call.
  if (targetLanguage === "en" && ASCII_ONLY.test(text)) return { detectedLanguage: "en", translation: null };
  try {
    const { json } = await generateJson(
      [{ text: translationPrompt(text, targetLanguage) }],
      {
        systemInstruction: TRANSLATION_SYSTEM_PROMPT,
        responseJsonSchema: TRANSLATION_JSON_SCHEMA,
        temperature: TRANSLATION_TEMPERATURE,
      },
      FAST_MODELS,
    );
    // Validated like any untrusted input; a malformed answer means "no translation".
    const answer = TranslationSchema.safeParse(json);
    if (!answer.success) return { detectedLanguage: scriptLanguage, translation: null };
    const detectedLanguage = answer.data.detectedLanguage.slice(0, MAX_LANGUAGE_CODE_CHARS) || scriptLanguage;
    const translated = answer.data.translation?.trim();
    const translation =
      translated && detectedLanguage !== targetLanguage ? translated.slice(0, MAX_TRANSLATION_CHARS) : null;
    return { detectedLanguage, translation };
  } catch (error) {
    log.warn("translate_failed", { error: describeError(error) });
    return { detectedLanguage: scriptLanguage, translation: null };
  }
}

/**
 * Check a department's "after" photo against the citizen's original photo
 * (when one exists) and the issue description. A "not_fixed" verdict is shown
 * to the admin and the citizen, so a closed ticket can't just be paperwork.
 * The verdict is advisory: the citizen still confirms or reopens.
 */
export async function verifyResolution(input: {
  summary: string;
  category: Category;
  before?: MediaPart | null;
  after: MediaPart;
}): Promise<{ verdict: AiVerdict; reason: string }> {
  if (!geminiEnabled()) return { verdict: "unclear", reason: "AI check unavailable; awaiting citizen confirmation." };
  try {
    const parts: Part[] = [{ text: verificationPrompt({ ...input, hasBeforePhoto: Boolean(input.before) }) }];
    if (input.before) parts.push(inlineMedia(input.before));
    parts.push(inlineMedia(input.after));
    const { json } = await generateJson(parts, {
      responseJsonSchema: VERIFICATION_JSON_SCHEMA,
      temperature: JUDGEMENT_TEMPERATURE,
    });
    const answer = VerificationSchema.safeParse(json);
    if (!answer.success) return { verdict: "unclear", reason: UNVERIFIED_FIX_REASON };
    return { verdict: answer.data.verdict, reason: answer.data.reason.slice(0, MAX_AI_REASON_CHARS) };
  } catch (error) {
    log.warn("verify_failed", { error: describeError(error) });
    return { verdict: "unclear", reason: UNVERIFIED_FIX_REASON };
  }
}
