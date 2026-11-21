// The pure steps of the reporting pipeline (src/lib/services/report.ts):
// validation, routing, duplicate-candidate selection, merging and building tickets.
import { describe, expect, it } from "vitest";
import {
  DUPLICATE_RADIUS_M,
  MAX_DUPLICATE_CANDIDATES,
  buildTicket,
  isValidLocation,
  parseCoordinate,
  parseUserCategory,
  receiptText,
  resolveRouting,
  selectDuplicateCandidates,
  validateReportContent,
  withAdditionalReporter,
  type ReportInput,
  type Triage,
} from "@/lib/services/report";
import type { Classification, Reporter, Ticket } from "@/lib/types";

const NOW = "2026-11-20T10:00:00.000Z";
const reporter: Reporter = { salt: "salt-1", email: null, phone: null, at: NOW };

const classification = (overrides: Partial<Classification> = {}): Classification => ({
  title: "Streetlight out",
  category: "Streetlight",
  priority: "Medium",
  priorityReason: "Dark stretch at night.",
  department: "Electricity Board (TANGEDCO)",
  englishSummary: "A streetlight is not working.",
  detectedLanguage: "en",
  transcript: null,
  ...overrides,
});

const report = (overrides: Partial<ReportInput> = {}): ReportInput => ({
  title: "Light not working",
  description: "The streetlight outside the school is off",
  address: "School road",
  lat: 12.92,
  lng: 79.13,
  userCategory: null,
  email: null,
  image: null,
  audio: null,
  ...overrides,
});

const triage = (overrides: Partial<Triage> = {}): Triage => ({
  classification: classification(),
  source: "gemini",
  category: "Streetlight",
  department: "Electricity Board (TANGEDCO)",
  ...overrides,
});

const openTicket = (id: string, lat: number, overrides: Partial<Ticket> = {}): Ticket => ({
  ...buildTicket({ id, report: report({ lat }), triage: triage(), reporter, verified: true, now: NOW }),
  ...overrides,
});

/** Degrees of latitude that are roughly `metres` on the ground. */
const latOffset = (metres: number) => metres / 111_320;

describe("report validation", () => {
  it("treats a blank coordinate as missing, not as zero", () => {
    expect(parseCoordinate("")).toBeNaN();
    expect(parseCoordinate("12.5")).toBe(12.5);
    expect(parseCoordinate("abc")).toBeNaN();
  });

  it("accepts only real points on Earth", () => {
    expect(isValidLocation(12.9, 79.1)).toBe(true);
    expect(isValidLocation(-90, 180)).toBe(true);
    expect(isValidLocation(90.1, 0)).toBe(false);
    expect(isValidLocation(0, -180.1)).toBe(false);
    expect(isValidLocation(NaN, 79.1)).toBe(false);
    expect(isValidLocation(12.9, Infinity)).toBe(false);
  });

  it("accepts the citizen's category only when it is a known value", () => {
    expect(parseUserCategory("Garbage")).toBe("Garbage");
    expect(parseUserCategory("garbage")).toBeNull();
    expect(parseUserCategory("")).toBeNull();
  });

  const content = { title: "", description: "", hasAudio: false, lat: 12.9, lng: 79.1 };

  it("needs a title, a description or a voice note", () => {
    expect(validateReportContent(content, true)).toEqual({
      ok: false,
      status: 400,
      error: "Add a title, a description or a voice note.",
    });
  });

  it("accepts a voice-only report from a verified reporter only", () => {
    expect(validateReportContent({ ...content, hasAudio: true }, true)).toBeNull();
    expect(validateReportContent({ ...content, hasAudio: true }, false)?.error).toMatch(/verify your phone/);
  });

  it("needs a location", () => {
    expect(validateReportContent({ ...content, title: "Pothole", lat: NaN }, false)).toEqual({
      ok: false,
      status: 400,
      error: "Pick a location on the map.",
    });
    expect(validateReportContent({ ...content, description: "Pothole" }, false)).toBeNull();
  });
});

describe("resolveRouting", () => {
  it("trusts the AI's category and department when the AI answered", () => {
    expect(resolveRouting(classification(), "gemini", "Garbage")).toEqual({
      category: "Streetlight",
      department: "Electricity Board (TANGEDCO)",
    });
  });

  it("respects the citizen's choice when the AI was unavailable", () => {
    expect(resolveRouting(classification(), "fallback", "Garbage")).toEqual({
      category: "Garbage",
      department: "Sanitation",
    });
  });

  it("falls back to the routing table when the citizen chose nothing", () => {
    const guess = classification({ category: "Pothole", department: "General Administration" });
    expect(resolveRouting(guess, "fallback", null)).toEqual({
      category: "Pothole",
      department: "Public Works (Roads)",
    });
  });
});

describe("selectDuplicateCandidates", () => {
  const here = { lat: 12.92, lng: 79.13 };

  it("keeps tickets inside the radius, nearest first", () => {
    const tickets = [
      openTicket("CR-1", here.lat + latOffset(150)),
      openTicket("CR-2", here.lat + latOffset(20)),
      openTicket("CR-3", here.lat + latOffset(DUPLICATE_RADIUS_M + 50)),
    ];
    const candidates = selectDuplicateCandidates(tickets, here);
    expect(candidates.map((candidate) => candidate.id)).toEqual(["CR-2", "CR-1"]);
    expect(candidates[0].distance).toBeCloseTo(20, 0);
  });

  it("never matches against held reports", () => {
    const tickets = [
      openTicket("CR-1", here.lat, { verification: "unverified" }),
      openTicket("CR-2", here.lat, { verification: "rejected" }),
      openTicket("CR-3", here.lat, { verification: "approved" }),
    ];
    expect(selectDuplicateCandidates(tickets, here).map((candidate) => candidate.id)).toEqual(["CR-3"]);
  });

  it("caps how many candidates reach the AI check", () => {
    const tickets = Array.from({ length: MAX_DUPLICATE_CANDIDATES + 3 }, (_, index) =>
      openTicket(`CR-${index}`, here.lat + latOffset(index)),
    );
    expect(selectDuplicateCandidates(tickets, here)).toHaveLength(MAX_DUPLICATE_CANDIDATES);
  });
});

describe("withAdditionalReporter", () => {
  const second: Reporter = { salt: "salt-2", email: "a@b.co", phone: null, at: NOW };

  it("counts the new reporter and logs the merge on the timeline", () => {
    const existing = openTicket("CR-1", 12.92);
    const merged = withAdditionalReporter(existing, {
      reporter: second,
      reason: "same lamp post",
      hasNewImage: false,
      now: NOW,
    });
    expect(merged.reporterCount).toBe(2);
    expect(merged.reporters).toEqual([reporter, second]);
    expect(merged.history?.at(-1)).toEqual({
      status: "Reported",
      at: NOW,
      note: "Another citizen reported this (same lamp post)",
    });
    expect(existing.reporterCount).toBe(1);
  });

  it("gains a photo if it had none, and keeps the one it had", () => {
    const merge = { reporter: second, reason: "r", now: NOW };
    expect(withAdditionalReporter(openTicket("CR-1", 12.92), { ...merge, hasNewImage: true }).hasImage).toBe(true);
    expect(
      withAdditionalReporter(openTicket("CR-1", 12.92, { hasImage: true }), { ...merge, hasNewImage: false }).hasImage,
    ).toBe(true);
  });

  it("raises the priority once enough people report the same problem", () => {
    const existing = openTicket("CR-1", 12.92, { reporterCount: 2 });
    const merged = withAdditionalReporter(existing, { reporter: second, reason: "r", hasNewImage: false, now: NOW });
    expect(merged).toMatchObject({ reporterCount: 3, basePriority: "Medium", priority: "High" });
  });
});

describe("buildTicket", () => {
  it("routes a verified report straight to its department", () => {
    const ticket = buildTicket({ id: "CR-9", report: report(), triage: triage(), reporter, verified: true, now: NOW });
    expect(ticket).toMatchObject({
      id: "CR-9",
      status: "Reported",
      verification: "phone",
      classifiedBy: "gemini",
      department: "Electricity Board (TANGEDCO)",
      reporterCount: 1,
      location: { lat: 12.92, lng: 79.13, address: "School road" },
    });
    expect(ticket.history).toEqual([{ status: "Reported", at: NOW, note: "Routed to Electricity Board (TANGEDCO)" }]);
    expect(receiptText(ticket, true)).toContain("sent to Electricity Board (TANGEDCO)");
  });

  it("holds an unverified report for review", () => {
    const ticket = buildTicket({
      id: "CR-9",
      report: report(),
      triage: triage({ source: "fallback" }),
      reporter,
      verified: false,
      now: NOW,
    });
    expect(ticket.verification).toBe("unverified");
    expect(ticket.history?.[0].note).toMatch(/^Held for review/);
    expect(receiptText(ticket, false)).toContain("a city officer will review it");
  });

  it("fills in title and description from the AI for a voice-only report", () => {
    const spoken = triage({ classification: classification({ title: "Broken lamp", transcript: "விளக்கு எரியவில்லை" }) });
    const ticket = buildTicket({
      id: "CR-9",
      report: report({ title: "", description: "" }),
      triage: spoken,
      reporter,
      verified: true,
      now: NOW,
    });
    expect(ticket.title).toBe("Broken lamp");
    expect(ticket.description).toBe("விளக்கு எரியவில்லை");
  });

  it("forces Critical when a safety rule fires, and says why", () => {
    const hazard = report({ description: "Live wire hanging over the footpath" });
    const ticket = buildTicket({ id: "CR-9", report: hazard, triage: triage(), reporter, verified: true, now: NOW });
    expect(ticket.priority).toBe("Critical");
    expect(ticket.basePriority).toBe("Medium");
    expect(ticket.priorityReason).toBe("Safety rule: live wire. Dark stretch at night.");
  });
});
