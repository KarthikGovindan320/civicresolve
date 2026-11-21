// Resolution workflow rules (src/lib/workflow.ts) and role-based
// access control (src/lib/auth.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { canActOn, staffRole } from "@/lib/auth";
import type { Ticket } from "@/lib/types";
import {
  isOverdue,
  isReporter,
  newReporter,
  slaDueAt,
  toPrivate,
  toPublic,
  tokenFor,
  withAutoClose,
} from "@/lib/workflow";

const base = (over: Partial<Ticket> = {}): Ticket =>
  ({
    id: "CR-1",
    title: "t",
    description: "d",
    originalLanguage: "en",
    englishSummary: "s",
    category: "Pothole",
    priority: "High",
    priorityReason: "",
    department: "Public Works (Roads)",
    status: "Reported",
    location: { lat: 0, lng: 0, address: "" },
    reporterCount: 1,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    resolvedAt: null,
    adminNotes: [],
    hasImage: false,
    ...over,
  }) as Ticket;

describe("SLA deadlines", () => {
  it("gives Critical 24 h and High 72 h", () => {
    expect(slaDueAt(base({ priority: "Critical" })).toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(slaDueAt(base({ priority: "High" })).toISOString()).toBe("2026-11-04T00:00:00.000Z");
  });
  it("flags open tickets past the deadline, never resolved ones", () => {
    const later = Date.parse("2026-11-10T00:00:00Z");
    expect(isOverdue(base(), later)).toBe(true);
    expect(isOverdue(base({ status: "Resolved" }), later)).toBe(false);
    expect(isOverdue(base(), Date.parse("2026-11-02T00:00:00Z"))).toBe(false);
  });
});

describe("citizen confirmation", () => {
  it("auto-closes a fix the citizen didn't answer within 3 days", () => {
    const t = base({ status: "Resolved", resolvedAt: "2026-11-01T00:00:00.000Z", citizenConfirmation: "pending" });
    expect(withAutoClose(t, Date.parse("2026-11-02T00:00:00Z")).citizenConfirmation).toBe("pending");
    expect(withAutoClose(t, Date.parse("2026-11-05T00:00:00Z")).citizenConfirmation).toBe("auto-closed");
  });
});

describe("private citizen links", () => {
  it("accepts the issued token and rejects anything else", () => {
    const { token, reporter } = newReporter("a@b.co");
    const t = base({ reporters: [reporter] });
    expect(isReporter(t, token)).toBe(true);
    expect(isReporter(t, token + "x")).toBe(false);
    expect(isReporter(t, null)).toBe(false);
    expect(tokenFor(reporter.salt)).toBe(token);
  });
  it("never stores the token itself", () => {
    const { token, reporter } = newReporter(null);
    expect(JSON.stringify(reporter)).not.toContain(token);
  });
});

describe("audience views never leak private data", () => {
  const { reporter } = newReporter("secret@citizen.in");
  const t = base({ reporters: [reporter], messages: [{ id: "m", from: "citizen", text: "hi", lang: "en", at: "" }] });
  it("public view has no reporters, emails or messages", () => {
    const s = JSON.stringify(toPublic(t));
    expect(s).not.toContain("secret@citizen.in");
    expect(s).not.toContain(reporter.salt);
    expect(s).not.toContain('"messages"');
    expect(toPublic(t).messageCount).toBe(1);
  });
  it("private view adds messages but still no reporter identities", () => {
    const s = JSON.stringify(toPrivate(t));
    expect(s).toContain('"messages"');
    expect(s).not.toContain("secret@citizen.in");
  });
});

describe("role-based access control", () => {
  afterEach(() => vi.unstubAllEnvs());
  const req = (k: string) => new Request("http://x", { headers: { "x-staff-key": k } });

  it("maps passcodes to roles", () => {
    vi.stubEnv("ADMIN_PASSCODE", "adm");
    vi.stubEnv("DEPT_PASSCODES", JSON.stringify({ Sanitation: "san", "Water Supply": "wat" }));
    expect(staffRole(req("adm"))).toEqual({ role: "admin" });
    expect(staffRole(req("san"))).toEqual({ role: "department", department: "Sanitation" });
    expect(staffRole(req("nope"))).toBeNull();
  });
  it("lets a department act only on its own tickets; admin on all", () => {
    const roads = base();
    expect(canActOn({ role: "department", department: "Public Works (Roads)" }, roads)).toBe(true);
    expect(canActOn({ role: "department", department: "Sanitation" }, roads)).toBe(false);
    expect(canActOn({ role: "admin" }, roads)).toBe(true);
    expect(canActOn(null, roads)).toBe(false);
  });
  it("ignores unknown departments and malformed config (fails closed)", () => {
    vi.stubEnv("DEPT_PASSCODES", JSON.stringify({ "Ministry of Magic": "x" }));
    expect(staffRole(req("x"))).toBeNull();
    vi.stubEnv("DEPT_PASSCODES", "{not json");
    vi.stubEnv("NODE_ENV", "production");
    expect(staffRole(req("roads123"))).toBeNull();
  });
});
