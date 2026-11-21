// [TESTING] AI layer resilience (src/lib/gemini.ts).
// Verifies that the app keeps working when Gemini is unavailable: every report
// still gets a valid category, department and language.
import { beforeEach, describe, expect, it } from "vitest";
import { classifyIssue, fallbackClassify, findDuplicate } from "@/lib/gemini";
import { CATEGORY_DEPARTMENT, type Ticket } from "@/lib/types";

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
});

describe("rule-based fallback classifier", () => {
  it.each([
    ["Big pothole near bus stand", "Pothole"],
    ["Garbage bin overflowing", "Garbage"],
    ["Streetlight not working", "Streetlight"],
    ["Water pipe leaking", "Water Leakage"],
    ["Drain blocked, sewage smell", "Sewage/Drainage"],
    ["Wire sparking on pole", "Electrical Hazard"],
    ["Something strange", "Other"],
  ])("classifies %j as %s", (text, category) => {
    const c = fallbackClassify({ description: text });
    expect(c.category).toBe(category);
    // BRIEF ✔ Department Recommendation is never left blank.
    expect(c.department).toBe(CATEGORY_DEPARTMENT[c.category]);
  });

  it("prefers the most dangerous category when several match", () => {
    expect(fallbackClassify({ description: "sparking wire next to a leaking water pipe" }).category).toBe(
      "Electrical Hazard",
    );
  });

  it("detects Tamil and Hindi scripts", () => {
    expect(fallbackClassify({ description: "தெருவிளக்கு எரியவில்லை" }).detectedLanguage).toBe("ta");
    expect(fallbackClassify({ description: "सड़क पर गड्ढा" }).detectedLanguage).toBe("hi");
    expect(fallbackClassify({ description: "pothole" }).detectedLanguage).toBe("en");
  });
});

describe("classifyIssue without an API key", () => {
  it("returns a fallback result instead of throwing", async () => {
    const r = await classifyIssue({ title: "Pothole", description: "large pothole" });
    expect(r.source).toBe("fallback");
    expect(r.result.category).toBe("Pothole");
  });
});

describe("findDuplicate without an API key", () => {
  const base = { englishSummary: "pothole", status: "Reported" } as Ticket;
  it("merges only very close reports (< 50 m)", async () => {
    const near = await findDuplicate({ summary: "x", category: "Pothole" }, [{ ...base, id: "CR-1", distance: 20 }]);
    const far = await findDuplicate({ summary: "x", category: "Pothole" }, [{ ...base, id: "CR-2", distance: 150 }]);
    expect(near.id).toBe("CR-1");
    expect(far.id).toBeNull();
  });

  it("returns no duplicate when there are no candidates", async () => {
    expect((await findDuplicate({ summary: "x", category: "Pothole" }, [])).id).toBeNull();
  });
});
