// =============================================================================
// Gemini client: API key handling, the model fallback chain and time budgets
// -----------------------------------------------------------------------------
// The features in ../gemini.ts describe *what* to ask; this module owns *how*
// the request is made, so that every AI feature gets the same resilience:
// structured JSON output, a per-attempt timeout and a fallback to the next model.
// =============================================================================
import { GoogleGenAI, ThinkingLevel, type Part } from "@google/genai";
import { describeError, log } from "../log";

const DEFAULT_PRIMARY_MODEL = "gemini-3.6-flash";
const LIGHT_MODEL = "gemini-3.5-flash-lite";
const LARGE_MODEL = "gemini-3.8-flash";
const primaryModel = () => process.env.GEMINI_MODEL || DEFAULT_PRIMARY_MODEL;

// Model fallback chains. The primary model can be overridden with GEMINI_MODEL.
// gemini-3.6-flash leads because, in our own measurements on the free tier, it
// answered in seconds while gemini-3.8-flash timed out under load. If a model
// is overloaded (timeout / 429 / 503) or unavailable to this key (404), the
// next one is tried, so a busy model never blocks a citizen's report.

/** For judgement-heavy multimodal work: classification and photo verification. */
export const SMART_MODELS = [...new Set([primaryModel(), LIGHT_MODEL, LARGE_MODEL])];
/**
 * For short text jobs (translation, duplicate matching): the lightest model
 * answers in a second or two and leaves the bigger models' quota for the work
 * that needs them.
 */
export const FAST_MODELS = [...new Set([LIGHT_MODEL, primaryModel()])];

/**
 * Total time we are willing to spend on AI per request. Past this point the
 * rule-based fallback takes over, so a report is always accepted in seconds.
 */
const TOTAL_BUDGET_MS = Number(process.env.GEMINI_TIMEOUT_MS || 25_000);
const PER_MODEL_BUDGET_MS = Math.ceil(TOTAL_BUDGET_MS / 2);
/** With less time than this left, another attempt could not finish, so we stop trying. */
const MIN_ATTEMPT_MS = 1500;
/** Model families that accept a thinking level. */
const THINKING_MODEL_PREFIX = "gemini-3";

/** An inline image or audio clip sent to Gemini. */
export interface MediaPart {
  mimeType: string;
  /** Base64-encoded bytes. */
  data: string;
}

/** Per-request generation settings; the response schema is always required. */
export interface JsonRequestConfig {
  systemInstruction?: string;
  responseJsonSchema: object;
  temperature: number;
}

// Created lazily. The API key is read only on the server (never sent to the
// browser), keeping the secret out of client bundles. In production it is
// injected from Google Secret Manager (see README → Deploy).
let cachedClient: GoogleGenAI | null = null;
function geminiClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  cachedClient ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return cachedClient;
}

/** Whether a Gemini API key is configured. Without one, every feature uses its rule-based fallback. */
export const geminiEnabled = () => Boolean(process.env.GEMINI_API_KEY);

/**
 * Call Gemini with JSON output, trying each model in `models` until one answers.
 * Each attempt is cancelled with an AbortController if it exceeds its time slice.
 * Throws when no model answers within the total budget.
 */
export async function generateJson(
  parts: Part[],
  config: JsonRequestConfig,
  models: string[] = SMART_MODELS,
): Promise<{ json: unknown; model: string }> {
  const client = geminiClient();
  if (!client) throw new Error("GEMINI_API_KEY not set");
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let lastError: unknown;
  for (const model of models) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < MIN_ATTEMPT_MS) break;
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), Math.min(PER_MODEL_BUDGET_MS, remainingMs));
    try {
      const response = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          ...config,
          // Structured output: Gemini must answer with JSON matching our schema,
          // which removes brittle free-text parsing entirely.
          responseMimeType: "application/json",
          // Triage is a short, well-defined task: low thinking keeps latency down.
          ...(model.startsWith(THINKING_MODEL_PREFIX) ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
          abortSignal: abortController.signal,
        },
      });
      return { json: JSON.parse(response.text ?? "{}"), model };
    } catch (error) {
      lastError = error;
      log.warn("gemini_model_failed", { model, error: describeError(error) });
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("Gemini time budget exhausted");
}
