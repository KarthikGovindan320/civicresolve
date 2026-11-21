// Proof of fix and the citizen's answer (src/lib/services/resolution.ts). The
// rules are functions of (ticket, input), checked here without a request; the
// one function that reads a photo gets a stub store.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCitizenAnswer,
  assessFix,
  fixSummary,
  parseCitizenAnswer,
  proofProblem,
  resolveProblem,
  resolveTicket,
} from "@/lib/services/resolution";
import type { Store } from "@/lib/store";
import type { Resolution, Role, Ticket } from "@/lib/types";

const AT = "2026-11-21T09:30:00.000Z";
const ADMIN: Role = { role: "admin" };
const SANITATION: Role = { role: "department", department: "Sanitation" };
const WATER: Role = { role: "department", department: "Water Supply" };

const garbageTicket = (changes: Partial<Ticket> = {}): Ticket => ({
  id: "CR-3001",
  title: "Overflowing bin at the market",
  description: "The bin has not been emptied this week",
  originalLanguage: "ta",
  englishSummary: "An overflowing garbage bin at the market",
  category: "Garbage",
  priority: "Medium",
  priorityReason: "Health concern.",
  department: "Sanitation",
  status: "In Progress",
  location: { lat: 12.93, lng: 79.14, address: "Market road" },
  reporterCount: 2,
  createdAt: "2026-11-18T08:00:00.000Z",
  updatedAt: "2026-11-19T08:00:00.000Z",
  resolvedAt: null,
  adminNotes: [],
  hasImage: true,
  history: [],
  messages: [],
  ...changes,
});

const resolution = (changes: Partial<Resolution> = {}): Resolution => ({
  note: "Bin emptied and area swept",
  hasPhoto: true,
  aiVerdict: "fixed",
  aiReason: "The bin is empty.",
  by: "Sanitation",
  at: AT,
  ...changes,
});

const resolved = () => garbageTicket({ status: "Resolved", resolvedAt: AT, citizenConfirmation: "pending" });

describe("who may report a fix", () => {
  it("refuses another department (403) and a ticket already resolved (409)", () => {
    expect(resolveProblem(WATER, garbageTicket())).toMatchObject({ status: 403 });
    expect(resolveProblem(SANITATION, resolved())).toMatchObject({ status: 409, error: "Already resolved." });
    expect(resolveProblem(SANITATION, garbageTicket())).toBeNull();
    expect(resolveProblem(ADMIN, garbageTicket({ department: "Water Supply" }))).toBeNull();
  });

  it("requires a photo from departments but not from the admin, and a note from everyone", () => {
    expect(proofProblem(SANITATION, { note: "Done", hasPhoto: false })).toMatchObject({ status: 400 });
    expect(proofProblem(ADMIN, { note: "Duplicate report", hasPhoto: false })).toBeNull();
    expect(proofProblem(ADMIN, { note: "", hasPhoto: true })).toMatchObject({ error: "Describe what was done." });
  });
});

describe("assessing a fix", () => {
  const getImage = vi.fn(async () => ({ mimeType: "image/jpeg", data: "/9j/" }));
  const db = { getImage } as unknown as Store;
  const photo = { mimeType: "image/jpeg", data: "/9j/4AAQ" };
  beforeEach(() => {
    getImage.mockClear();
    delete process.env.GEMINI_API_KEY;
  });

  it("records a close without a photo as unchecked, without reading anything", async () => {
    const fix = { note: "Invalid report", afterPhoto: null, by: "City Admin", at: AT };
    expect(await assessFix(db, garbageTicket(), fix)).toEqual({
      note: "Invalid report",
      hasPhoto: false,
      aiVerdict: "unclear",
      aiReason: "No after-photo was provided.",
      by: "City Admin",
      at: AT,
    });
    expect(getImage).not.toHaveBeenCalled();
  });

  it("records the after-photo, and reads the before-photo only when the ticket has one", async () => {
    const fix = { note: "Swept", afterPhoto: photo, by: "Sanitation", at: AT };
    const assessed = await assessFix(db, garbageTicket(), fix);
    expect(assessed).toMatchObject({ hasPhoto: true, aiVerdict: "unclear", note: "Swept" }); // no AI key: unclear
    expect(getImage).toHaveBeenCalledWith("CR-3001");
    getImage.mockClear();
    await assessFix(db, garbageTicket({ hasImage: false }), fix);
    expect(getImage).not.toHaveBeenCalled();
  });

  it("warns publicly when the AI doubts the photo shows the fix", () => {
    expect(fixSummary(resolution())).toBe("Sanitation reports this is fixed: Bin emptied and area swept");
    expect(fixSummary(resolution({ aiVerdict: "not_fixed" }))).toBe(
      "Sanitation reports this is fixed: Bin emptied and area swept ⚠ AI check: the photo may not show the issue fixed.",
    );
  });
});

describe("closing the ticket as fixed", () => {
  it("records the proof, asks the citizen to confirm, and logs it on the timeline", () => {
    const result = resolveTicket(garbageTicket(), SANITATION, resolution());
    if (!result.ok) throw new Error(result.error);
    const { ticket } = result;
    expect(ticket).toMatchObject({ status: "Resolved", resolvedAt: AT, citizenConfirmation: "pending" });
    expect(ticket.resolution).toEqual(resolution());
    expect(ticket.history?.at(-1)).toEqual({ status: "Resolved", at: AT, note: fixSummary(resolution()) });
    expect(ticket.messages?.at(-1)).toMatchObject({ from: "system", text: expect.stringMatching(/Please confirm/) });
  });

  it("is refused if the ticket moved to another department meanwhile", () => {
    const transferred = garbageTicket({ department: "Water Supply" });
    expect(resolveTicket(transferred, SANITATION, resolution())).toMatchObject({ ok: false, status: 403 });
  });
});

describe("the citizen's answer", () => {
  it("is accepted only while a fix awaits it, with a known decision and, to reopen, a reason", () => {
    expect(parseCitizenAnswer(garbageTicket(), "confirm", "")).toMatchObject({ status: 409 });
    expect(parseCitizenAnswer(resolved(), "maybe", "")).toMatchObject({ status: 400 });
    expect(parseCitizenAnswer(resolved(), "reopen", "")).toMatchObject({
      error: "Tell the department what is still wrong.",
    });
    expect(parseCitizenAnswer(resolved(), "confirm", "")).toEqual({ ok: true, decision: "confirm", note: "" });
  });

  it("confirming closes it for good, with a thank-you when the citizen wrote nothing", () => {
    const result = applyCitizenAnswer(resolved(), { decision: "confirm", note: "", hasPhoto: false, now: AT });
    if (!result.ok) throw new Error(result.error);
    expect(result.ticket).toMatchObject({ status: "Resolved", citizenConfirmation: "confirmed", updatedAt: AT });
    expect(result.ticket.messages?.at(-1)).toMatchObject({
      from: "citizen",
      text: "Confirmed: it's fixed. Thank you!",
    });
  });

  it("reopening sends it back to the department with the citizen's reason and evidence", () => {
    const answer = { decision: "reopen" as const, note: "Bin is full again", hasPhoto: true, now: AT };
    const result = applyCitizenAnswer({ ...resolved(), reopenCount: 1 }, answer);
    if (!result.ok) throw new Error(result.error);
    expect(result.ticket).toMatchObject({
      status: "In Progress",
      resolvedAt: null,
      citizenConfirmation: "reopened",
      reopenCount: 2,
      hasReopenPhoto: true,
    });
    expect(result.ticket.history?.at(-1)?.note).toBe("Reopened by citizen: Bin is full again");
    expect(result.ticket.messages?.at(-1)?.text).toBe("Not fixed: Bin is full again");
  });

  it("is refused if the ticket was reopened by someone else meanwhile", () => {
    const answer = { decision: "confirm" as const, note: "", hasPhoto: false, now: AT };
    expect(applyCitizenAnswer(garbageTicket(), answer)).toMatchObject({ ok: false, status: 409 });
  });
});
