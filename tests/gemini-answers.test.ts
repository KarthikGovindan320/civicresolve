// Gemini's answers are untrusted input (src/lib/gemini.ts). With the model call
// mocked, these tests check that every AI feature validates the answer it gets
// back and falls back safely when the answer is malformed or the call fails.
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateJson = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/client")>()),
  geminiEnabled: () => true,
  generateJson,
}));

const { classifyIssue, findDuplicate, translateMessage, verifyResolution } = await import("@/lib/gemini");

const photo = { mimeType: "image/jpeg", data: "abc" };
const answer = (json: unknown) => generateJson.mockResolvedValueOnce({ json, model: "test-model" });

beforeEach(() => {
  generateJson.mockReset();
});

describe("classifyIssue", () => {
  const report = { title: "Pothole", description: "Deep pothole near the bus stand" };

  it("uses a well-formed answer as is", async () => {
    const classification = {
      title: "Deep pothole",
      category: "Pothole",
      priority: "High",
      priorityReason: "Two-wheelers swerve into traffic.",
      department: "Public Works (Roads)",
      englishSummary: "A deep pothole near the bus stand.",
      detectedLanguage: "en",
      transcript: null,
    };
    answer(classification);
    expect(await classifyIssue(report)).toEqual({ result: classification, source: "gemini" });
  });

  it("falls back to the keyword classifier when the answer breaks the schema", async () => {
    answer({ category: "Volcano" });
    const { source, error, result } = await classifyIssue(report);
    expect({ source, error }).toEqual({ source: "fallback", error: "schema mismatch" });
    expect(result.category).toBe("Pothole");
  });

  it("falls back when the call fails, with a short error description", async () => {
    generateJson.mockRejectedValueOnce(new Error("quota exceeded"));
    const { source, error } = await classifyIssue(report);
    expect(source).toBe("fallback");
    expect(error).toContain("quota exceeded");
  });
});

describe("findDuplicate", () => {
  const candidates = [{ id: "CR-1001", distance: 40, englishSummary: "Pothole at the bus stand" }];
  const incoming = { summary: "Pothole at the bus stand", category: "Pothole" as const, image: photo };

  it("accepts only an id that is one of the candidates", async () => {
    answer({ duplicateOf: "CR-1001", reason: "Same pothole." });
    expect(await findDuplicate(incoming, candidates)).toEqual({ id: "CR-1001", reason: "Same pothole." });
    answer({ duplicateOf: "CR-9999", reason: "Invented id." });
    expect((await findDuplicate(incoming, candidates)).id).toBeNull();
  });

  it("treats a malformed answer or a failed call as no duplicate", async () => {
    answer({ duplicate: true });
    expect(await findDuplicate(incoming, candidates)).toEqual({ id: null, reason: "No confident match." });
    generateJson.mockRejectedValueOnce(new Error("timeout"));
    expect(await findDuplicate(incoming, candidates)).toEqual({ id: null, reason: "Duplicate check unavailable." });
  });
});

describe("translateMessage", () => {
  it("returns the translation when the languages differ", async () => {
    answer({ detectedLanguage: "ta", translation: "  Thank you.  " });
    expect(await translateMessage("நன்றி", "en")).toEqual({ detectedLanguage: "ta", translation: "Thank you." });
  });

  it("returns no translation when the text is already in the target language", async () => {
    answer({ detectedLanguage: "ta", translation: "நன்றி" });
    expect((await translateMessage("நன்றி", "ta")).translation).toBeNull();
  });

  it("keeps the original text when the answer is malformed or the call fails", async () => {
    answer({ translation: 42 });
    expect(await translateMessage("நன்றி", "en")).toEqual({ detectedLanguage: "ta", translation: null });
    generateJson.mockRejectedValueOnce(new Error("overloaded"));
    expect(await translateMessage("नमस्ते", "en")).toEqual({ detectedLanguage: "hi", translation: null });
  });

  it("skips the AI for plain English going to an English reader", async () => {
    expect(await translateMessage("Crew on the way", "en")).toEqual({ detectedLanguage: "en", translation: null });
    expect(generateJson).not.toHaveBeenCalled();
  });
});

describe("verifyResolution", () => {
  const fix = { summary: "Pothole at the bus stand", category: "Pothole" as const, before: photo, after: photo };

  it("passes on a valid verdict and sends both photos", async () => {
    answer({ verdict: "fixed", reason: "Patched with asphalt." });
    expect(await verifyResolution(fix)).toEqual({ verdict: "fixed", reason: "Patched with asphalt." });
    const [parts] = generateJson.mock.calls[0];
    expect(parts).toHaveLength(3); // prompt, before photo, after photo
  });

  it("answers 'unclear' for a malformed verdict or a failed call", async () => {
    const unclear = { verdict: "unclear", reason: "AI check failed; awaiting citizen confirmation." };
    answer({ verdict: "probably", reason: "?" });
    expect(await verifyResolution(fix)).toEqual(unclear);
    generateJson.mockRejectedValueOnce(new Error("timeout"));
    expect(await verifyResolution(fix)).toEqual(unclear);
  });
});
