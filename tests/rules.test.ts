// Priority Detection rules (src/lib/rules.ts).
// These guard the life-safety guarantees: if any of these fail, a dangerous
// issue could be under-prioritised.
import { describe, expect, it } from "vitest";
import { effectivePriority, haversine, recomputePriority, safetyRuleHit } from "@/lib/rules";
import type { Ticket } from "@/lib/types";

describe("safety rules", () => {
  it.each([
    ["A live wire is hanging near the gate", "live wire"],
    ["Wire SPARKING on the pole", "live wire"],
    ["Manhole cover missing on footpath", "open manhole"],
    ["open manhole near school", "open manhole"],
    ["Sewage overflow on main road", "sewage overflow"],
  ])("flags %j as %s", (text, label) => {
    expect(safetyRuleHit(text)).toBe(label);
  });

  it("does not flag ordinary issues", () => {
    expect(safetyRuleHit("Garbage bin overflowing near market")).toBeNull();
    expect(safetyRuleHit("Small pothole on the side road")).toBeNull();
  });

  it("forces Critical regardless of the AI's priority", () => {
    expect(effectivePriority("Low", 1, "live wire").priority).toBe("Critical");
  });
});

describe("public-impact priority boost", () => {
  it("does not change priority for a single reporter", () => {
    expect(effectivePriority("Medium", 1, null)).toEqual({ priority: "Medium", note: null });
  });

  it("bumps one level at 3 reporters and explains why", () => {
    const r = effectivePriority("Medium", 3, null);
    expect(r.priority).toBe("High");
    expect(r.note).toMatch(/3 people reported/);
  });

  it("never lets popularity alone reach Critical", () => {
    expect(effectivePriority("High", 50, null).priority).toBe("High");
    expect(effectivePriority("Low", 10, null).priority).toBe("High");
  });

  it("never lowers the AI's own Critical call", () => {
    expect(effectivePriority("Critical", 1, null).priority).toBe("Critical");
  });

  it("is idempotent: recomputing repeatedly doesn't compound bumps", () => {
    const t = { title: "x", description: "bin", englishSummary: "bin", priority: "Low", reporterCount: 3 } as Ticket;
    const once = recomputePriority(t);
    const twice = recomputePriority(once);
    expect(once.priority).toBe("Medium");
    expect(twice.priority).toBe("Medium");
    expect(twice.basePriority).toBe("Low");
  });
});

describe("haversine distance", () => {
  it("is zero for the same point", () => {
    expect(haversine({ lat: 12.9, lng: 79.1 }, { lat: 12.9, lng: 79.1 })).toBe(0);
  });

  it("matches a known distance (~111 m per 0.001° latitude)", () => {
    const d = haversine({ lat: 12.9, lng: 79.1 }, { lat: 12.901, lng: 79.1 });
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(117);
  });
});

// Safety rules also fire on untranslated Tamil and Hindi text (used when a report skips Gemini).
describe("multilingual safety rules", () => {
  it.each([
    ["பேருந்து நிறுத்தம் அருகே மின் கம்பி அறுந்து கிடக்கிறது", "live wire"],
    ["सड़क पर खुला मैनहोल है", "open manhole"],
    ["தெருவில் கழிவுநீர் ஓடுகிறது", "sewage overflow"],
  ])("%s → %s", (text, label) => expect(safetyRuleHit(text)).toBe(label));
  it("does not fire on ordinary complaints", () => expect(safetyRuleHit("குப்பை அள்ளப்படவில்லை")).toBeNull());
});
