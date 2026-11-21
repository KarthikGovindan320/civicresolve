// The Gemini client (src/lib/ai/client.ts) with @google/genai mocked: the model
// fallback chain, the per-model timeout, the overall time budget, a model that
// answers with invalid JSON, and a missing API key. Fake timers keep the
// timeout tests instant and deterministic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Request = { model: string; config: { abortSignal: AbortSignal; thinkingConfig?: unknown } };
const generateContent = vi.fn<(request: Request) => Promise<{ text?: string }>>();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
  ThinkingLevel: { LOW: "LOW" },
}));

/** A fresh copy of client.ts, so the budget and model chain follow this test's environment. */
async function loadClient(env: Record<string, string> = {}) {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_MODEL", "");
  vi.stubEnv("GEMINI_TIMEOUT_MS", "4000"); // 2 s per model, 4 s in all
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return import("@/lib/ai/client");
}
const PARTS = [{ text: "classify this" }];
const CONFIG = { responseJsonSchema: { type: "object" }, temperature: 0 };
/** A model call that never answers on its own: it fails only when its time slice is aborted. */
const hangUntilAborted = ({ config }: Request) =>
  new Promise<{ text?: string }>((_, reject) =>
    config.abortSignal.addEventListener("abort", () => reject(new Error("aborted"))),
  );
const calledModels = () => generateContent.mock.calls.map(([request]) => request.model);

beforeEach(() => {
  vi.resetModules();
  generateContent.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("generateJson", () => {
  it("refuses to run without an API key", async () => {
    const { generateJson, geminiEnabled } = await loadClient({ GEMINI_API_KEY: "" });
    expect(geminiEnabled()).toBe(false);
    await expect(generateJson(PARTS, CONFIG)).rejects.toThrow("GEMINI_API_KEY not set");
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("returns the first model's parsed JSON, asking for JSON with low thinking", async () => {
    generateContent.mockResolvedValueOnce({ text: '{"category":"Pothole"}' });
    const { SMART_MODELS, generateJson } = await loadClient();
    expect(await generateJson(PARTS, CONFIG)).toEqual({ json: { category: "Pothole" }, model: SMART_MODELS[0] });
    const [[request]] = generateContent.mock.calls;
    expect(request.config).toMatchObject({
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "LOW" },
    });
  });

  it("falls back to the next model when one fails, including on invalid JSON", async () => {
    generateContent
      .mockRejectedValueOnce(new Error("503 overloaded"))
      .mockResolvedValueOnce({ text: "not json" })
      .mockResolvedValueOnce({ text: '{"ok":true}' });
    const { SMART_MODELS, generateJson } = await loadClient();
    expect(await generateJson(PARTS, CONFIG)).toEqual({ json: { ok: true }, model: SMART_MODELS[2] });
    expect(calledModels()).toEqual(SMART_MODELS);
  });

  it("puts the primary model first when GEMINI_MODEL is set, and uses the light model for fast jobs", async () => {
    const { FAST_MODELS, SMART_MODELS } = await loadClient({ GEMINI_MODEL: "gemini-custom" });
    expect(SMART_MODELS[0]).toBe("gemini-custom");
    expect(FAST_MODELS).toContain("gemini-custom");
    expect(FAST_MODELS[0]).not.toBe("gemini-custom");
  });

  it("throws the last error once every model has failed", async () => {
    generateContent.mockResolvedValue({ text: "{broken" });
    const { SMART_MODELS, generateJson } = await loadClient();
    await expect(generateJson(PARTS, CONFIG)).rejects.toThrow(SyntaxError);
    expect(generateContent).toHaveBeenCalledTimes(SMART_MODELS.length);
  });

  it("aborts a model that exceeds its time slice and stops once the overall budget is spent", async () => {
    vi.useFakeTimers();
    generateContent.mockImplementation(hangUntilAborted);
    const { SMART_MODELS, generateJson } = await loadClient();
    const outcome = generateJson(PARTS, CONFIG).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2000); // first model's 2 s slice ends: aborted
    expect(calledModels()).toEqual(SMART_MODELS.slice(0, 2));
    await vi.advanceTimersByTimeAsync(2000); // second slice ends with the 4 s budget: no time for a third
    expect(await outcome).toEqual(new Error("aborted"));
    expect(calledModels()).toEqual(SMART_MODELS.slice(0, 2));
  });
});
