// Staff actions on a ticket (src/lib/services/ticket-actions.ts) and the request
// schema that feeds them (src/lib/schemas.ts). Each action is a pure function,
// so its rules are checked here without a database or a request.
import { describe, expect, it } from "vitest";
import { TicketActionSchema } from "@/lib/schemas";
import {
  acknowledgeTicket,
  addTicketNote,
  applyTicketAction,
  reviewTicket,
  transferTicket,
  updateTicket,
  type ActionContext,
  type ActionResult,
} from "@/lib/services/ticket-actions";
import type { Role, Ticket } from "@/lib/types";
import { appendHistory, appendMessage, systemMessage } from "@/lib/workflow";

const NOW = "2026-11-20T10:00:00.000Z";
const ADMIN: Role = { role: "admin" };
const ROADS: Role = { role: "department", department: "Public Works (Roads)" };
const as = (role: Role): ActionContext => ({ role, now: NOW });

const ticket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: "CR-2001",
  title: "Pothole near the bus stand",
  description: "Deep pothole in the left lane",
  originalLanguage: "en",
  englishSummary: "Deep pothole in the left lane",
  category: "Pothole",
  priority: "Medium",
  basePriority: "Medium",
  priorityReason: "Injury risk for two-wheelers.",
  department: "Public Works (Roads)",
  status: "Reported",
  location: { lat: 12.9, lng: 79.1, address: "Bus stand" },
  reporterCount: 1,
  createdAt: "2026-11-19T10:00:00.000Z",
  updatedAt: "2026-11-19T10:00:00.000Z",
  resolvedAt: null,
  adminNotes: [],
  hasImage: false,
  history: [{ status: "Reported", at: "2026-11-19T10:00:00.000Z" }],
  messages: [],
  ...overrides,
});

/** Unwrap a successful result, failing the test with the error message otherwise. */
function succeeded(result: ActionResult) {
  if (!result.ok) throw new Error(`expected success, got ${result.status}: ${result.error}`);
  return result;
}
const lastHistory = (t: Ticket) => t.history?.at(-1);
/** Parse a PATCH body the way the route does: the typed action, or null when it is rejected. */
const parseAction = (body: unknown) => TicketActionSchema.safeParse(body).data ?? null;

describe("TicketActionSchema (PATCH body schema)", () => {
  it("rejects a body without a known action", () => {
    expect(parseAction({ status: "Resolved" })).toBeNull();
    expect(parseAction({ action: 7 })).toBeNull();
    expect(parseAction({ action: "delete" })).toBeNull();
    expect(parseAction(null)).toBeNull();
    expect(parseAction({ action: "update", status: "Resolved" })).toMatchObject({ status: "Resolved", note: "" });
  });

  it("trims and caps the note, and ignores a note that is not text", () => {
    expect(parseAction({ action: "note", note: `  ${"x".repeat(600)}  ` })).toEqual({
      action: "note",
      note: "x".repeat(500),
    });
    expect(parseAction({ action: "note", note: 42 })).toEqual({ action: "note", note: "" });
  });

  it("reads malformed fields as not provided, leaving the error to the action", () => {
    expect(parseAction({ action: "review", decision: "maybe" })).toMatchObject({ decision: null });
    expect(parseAction({ action: "acknowledge", expectedFixDate: "next week" })).toMatchObject({
      expectedFixDate: null,
    });
    expect(parseAction({ action: "acknowledge", expectedFixDate: "2026-12-01" })).toMatchObject({
      expectedFixDate: "2026-12-01",
    });
    expect(parseAction({ action: "transfer", department: "Parks" })).toMatchObject({ department: null });
    expect(parseAction({ action: "transfer" })).toMatchObject({ department: null });
  });

  it("whitelists override values against the domain enums", () => {
    const parsed = parseAction({
      action: "update",
      status: "Closed",
      category: "Volcano",
      priority: "Urgent",
      department: "Parks",
      extra: 1,
    });
    expect(parsed).toEqual({
      action: "update",
      status: undefined,
      category: undefined,
      priority: undefined,
      department: undefined,
      note: "",
    });
  });
});

describe("reviewTicket", () => {
  const held = ticket({ verification: "unverified" });

  it("is admin-only", () => {
    expect(reviewTicket(held, { action: "review", decision: "approve", note: "" }, as(ROADS))).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("only applies to reports waiting for review", () => {
    const result = reviewTicket(
      ticket({ verification: "phone" }),
      { action: "review", decision: "approve", note: "" },
      as(ADMIN),
    );
    expect(result).toEqual({ ok: false, status: 400, error: "This report is not waiting for review." });
  });

  it("needs a decision", () => {
    expect(reviewTicket(held, { action: "review", decision: null, note: "" }, as(ADMIN))).toEqual({
      ok: false,
      status: 400,
      error: "Decision must be 'approve' or 'reject'.",
    });
  });

  it("approves: the report joins the department queue and the reporter is told", () => {
    const {
      ticket: approved,
      notice,
      audit,
    } = succeeded(reviewTicket(held, { action: "review", decision: "approve", note: "Looks genuine." }, as(ADMIN)));
    expect(approved.verification).toBe("approved");
    expect(lastHistory(approved)).toEqual({
      status: "Reported",
      at: NOW,
      note: "Reviewed by the city admin and sent to Public Works (Roads). Looks genuine.",
    });
    expect(notice?.subject).toBe("Your report was accepted for action");
    expect(audit).toEqual({ event: "ticket_reviewed", fields: { id: "CR-2001", decision: "approve" } });
  });

  it("rejects: the report stays hidden, with the reason on record", () => {
    const { ticket: rejected, notice } = succeeded(
      reviewTicket(held, { action: "review", decision: "reject", note: "Spam" }, as(ADMIN)),
    );
    expect(rejected.verification).toBe("rejected");
    expect(lastHistory(rejected)?.note).toBe("Not accepted after review: Spam");
    expect(notice).toEqual({
      subject: "Your report was not accepted",
      text: "After review, this report was not accepted. Reason: Spam",
    });
  });

  it("does not mutate the ticket it was given", () => {
    const before = structuredClone(held);
    reviewTicket(held, { action: "review", decision: "approve", note: "" }, as(ADMIN));
    expect(held).toEqual(before);
  });
});

describe("acknowledgeTicket", () => {
  it("moves the ticket to In Progress with a public commitment", () => {
    const { ticket: accepted, notice } = succeeded(
      acknowledgeTicket(
        ticket(),
        { action: "acknowledge", expectedFixDate: "2026-11-24", note: "Crew assigned." },
        as(ROADS),
      ),
    );
    expect(accepted).toMatchObject({
      status: "In Progress",
      acknowledgedAt: NOW,
      expectedFixDate: "2026-11-24",
      resolvedAt: null,
    });
    expect(notice?.text).toBe(
      "Public Works (Roads) accepted this issue and expects to fix it by 24 Nov 2026. Crew assigned.",
    );
    expect(lastHistory(accepted)).toEqual({ status: "In Progress", at: NOW, note: notice?.text });
  });

  it("works without a fix date or note", () => {
    const { ticket: accepted, notice } = succeeded(
      acknowledgeTicket(ticket(), { action: "acknowledge", expectedFixDate: null, note: "" }, as(ADMIN)),
    );
    expect(accepted.expectedFixDate).toBeNull();
    expect(notice?.text).toBe("City Admin accepted this issue.");
  });
});

describe("acknowledgeTicket guards", () => {
  it("only accepts a newly reported, reviewed issue", () => {
    for (const current of [ticket({ status: "In Progress" }), ticket({ status: "Resolved", resolvedAt: NOW })]) {
      expect(acknowledgeTicket(current, { action: "acknowledge", expectedFixDate: null, note: "" }, as(ROADS))).toEqual(
        { ok: false, status: 400, error: "Only a newly reported issue can be accepted." },
      );
    }
    expect(
      acknowledgeTicket(
        ticket({ verification: "unverified" }),
        { action: "acknowledge", expectedFixDate: null, note: "" },
        as(ADMIN),
      ),
    ).toEqual({ ok: false, status: 400, error: "This report is waiting for the city admin's review." });
  });

  it("records an audit event for the acceptance", () => {
    const result = acknowledgeTicket(
      ticket(),
      { action: "acknowledge", expectedFixDate: "2026-11-24", note: "" },
      as(ROADS),
    );
    expect(result.ok && result.audit).toEqual({
      event: "ticket_acknowledged",
      fields: { id: "CR-2001", by: "Public Works (Roads)", expectedFixDate: "2026-11-24" },
    });
  });
});

describe("transferTicket", () => {
  it("refuses a missing, unknown or unchanged department", () => {
    for (const department of [null, "Public Works (Roads)"] as const) {
      expect(transferTicket(ticket(), { action: "transfer", department, note: "Why" }, as(ROADS))).toEqual({
        ok: false,
        status: 400,
        error: "Choose a different, valid department.",
      });
    }
  });

  it("requires a reason", () => {
    expect(transferTicket(ticket(), { action: "transfer", department: "Sanitation", note: "" }, as(ROADS))).toEqual({
      ok: false,
      status: 400,
      error: "Give a reason for the transfer.",
    });
  });

  it("re-routes the ticket to the new department's intake queue", () => {
    const accepted = ticket({
      status: "In Progress",
      acknowledgedAt: NOW,
      expectedFixDate: "2026-11-24",
      transfers: 1,
    });
    const {
      ticket: moved,
      notice,
      audit,
    } = succeeded(
      transferTicket(
        accepted,
        { action: "transfer", department: "Sanitation", note: "It is a garbage heap." },
        as(ROADS),
      ),
    );
    expect(moved).toMatchObject({
      department: "Sanitation",
      status: "Reported",
      acknowledgedAt: null,
      expectedFixDate: null,
      transfers: 2,
    });
    expect(notice?.text).toBe("Transferred from Public Works (Roads) to Sanitation: It is a garbage heap.");
    expect(audit?.fields).toEqual({ id: "CR-2001", from: "Public Works (Roads)", to: "Sanitation" });
  });
});

describe("addTicketNote", () => {
  it("refuses an empty note", () => {
    expect(addTicketNote(ticket(), { action: "note", note: "" }, as(ROADS))).toEqual({
      ok: false,
      status: 400,
      error: "Note is empty.",
    });
  });

  it("adds an attributed note to the timeline without notifying reporters", () => {
    const { ticket: noted, notice } = succeeded(
      addTicketNote(ticket(), { action: "note", note: "Inspected." }, as(ROADS)),
    );
    expect(lastHistory(noted)).toEqual({ status: "Reported", at: NOW, note: "Public Works (Roads): Inspected." });
    expect(noted.adminNotes).toEqual(["Inspected."]);
    expect(notice).toBeNull();
  });
});

describe("updateTicket (admin overrides)", () => {
  it("is admin-only", () => {
    expect(updateTicket(ticket(), { action: "update", status: "Resolved", note: "" }, as(ROADS))).toEqual({
      ok: false,
      status: 403,
      error: "Only the city admin can do this.",
    });
  });

  it("resolving records a resolution and waits for the citizen", () => {
    const { ticket: resolved, notice } = succeeded(
      updateTicket(ticket(), { action: "update", status: "Resolved", note: "" }, as(ADMIN)),
    );
    expect(resolved).toMatchObject({ status: "Resolved", resolvedAt: NOW, citizenConfirmation: "pending" });
    expect(resolved.resolution).toEqual({
      note: "Marked resolved by the city admin.",
      hasPhoto: false,
      aiVerdict: "unclear",
      aiReason: "No after-photo was provided.",
      by: "City Admin",
      at: NOW,
    });
    expect(notice).toEqual({ subject: "Status changed to Resolved", text: "Your issue is now Resolved." });
  });

  it("moving out of Resolved clears resolvedAt", () => {
    const { ticket: reopened } = succeeded(
      updateTicket(
        ticket({ status: "Resolved", resolvedAt: NOW }),
        { action: "update", status: "In Progress", note: "Not done" },
        as(ADMIN),
      ),
    );
    expect(reopened.resolvedAt).toBeNull();
    expect(lastHistory(reopened)).toEqual({ status: "In Progress", at: NOW, note: "Not done" });
    expect(reopened.adminNotes).toEqual(["Not done"]);
  });

  it("moving out of Resolved clears the proof of fix and the citizen's verdict", () => {
    const { ticket: reopened } = succeeded(
      updateTicket(
        ticket({
          status: "Resolved",
          resolvedAt: NOW,
          citizenConfirmation: "confirmed",
          resolution: { note: "Done", hasPhoto: true, aiVerdict: "fixed", aiReason: "Patched", by: "Roads", at: NOW },
        }),
        { action: "update", status: "In Progress", note: "" },
        as(ADMIN),
      ),
    );
    expect(reopened).toMatchObject({ status: "In Progress", resolution: null, citizenConfirmation: null });
  });

  it("logs which fields an override changed", () => {
    const result = updateTicket(ticket(), { action: "update", category: "Garbage", note: "" }, as(ADMIN));
    expect(result.ok && result.audit).toEqual({
      event: "ticket_updated",
      fields: { id: "CR-2001", changed: ["category", "department"] },
    });
  });

  it("an unchanged status with a note only records the note", () => {
    const { ticket: noted, notice } = succeeded(
      updateTicket(ticket(), { action: "update", status: "Reported", note: "Checked" }, as(ADMIN)),
    );
    expect(noted.status).toBe("Reported");
    expect(lastHistory(noted)).toEqual({ status: "Reported", at: NOW, note: "Checked" });
    expect(notice).toBeNull();
  });

  it("with nothing to change, leaves the timeline alone", () => {
    const original = ticket();
    const { ticket: same } = succeeded(updateTicket(original, { action: "update", note: "" }, as(ADMIN)));
    expect(same.history).toEqual(original.history);
  });

  it("changing the category re-routes the department, unless one was named", () => {
    const rerouted = succeeded(
      updateTicket(ticket(), { action: "update", category: "Garbage", note: "" }, as(ADMIN)),
    ).ticket;
    expect(rerouted).toMatchObject({ category: "Garbage", department: "Sanitation" });

    const pinned = succeeded(
      updateTicket(
        ticket(),
        { action: "update", category: "Garbage", department: "Water Supply", note: "" },
        as(ADMIN),
      ),
    ).ticket;
    expect(pinned).toMatchObject({ category: "Garbage", department: "Water Supply" });

    // An unknown department is dropped when the body is parsed, so the category's own department applies.
    const parsed = parseAction({ action: "update", category: "Garbage", department: "Parks" });
    expect(parsed).toMatchObject({ department: undefined });
    if (parsed?.action !== "update") throw new Error("expected an update action");
    expect(succeeded(updateTicket(ticket(), parsed, as(ADMIN))).ticket).toMatchObject({
      category: "Garbage",
      department: "Sanitation",
    });
  });

  it("a priority override resets the base priority too", () => {
    const { ticket: raised } = succeeded(
      updateTicket(ticket(), { action: "update", priority: "High", note: "" }, as(ADMIN)),
    );
    expect(raised).toMatchObject({ priority: "High", basePriority: "High" });
  });
});

describe("applyTicketAction", () => {
  it("stamps updatedAt and adds the notice to the conversation", () => {
    const { ticket: accepted, notice } = succeeded(
      applyTicketAction(ticket(), { action: "acknowledge", expectedFixDate: null, note: "" }, as(ROADS)),
    );
    expect(accepted.updatedAt).toBe(NOW);
    expect(accepted.messages).toHaveLength(1);
    expect(accepted.messages?.[0]).toMatchObject({
      from: "system",
      text: notice?.text,
      lang: "en",
      translation: null,
      at: NOW,
    });
  });

  it("adds no message when the action notifies nobody", () => {
    const { ticket: noted } = succeeded(applyTicketAction(ticket(), { action: "note", note: "Inspected." }, as(ROADS)));
    expect(noted.messages).toEqual([]);
  });

  it("re-applies the safety rules, so a hazard cannot be downgraded", () => {
    const hazard = ticket({ title: "Open manhole on main road", priority: "Critical", basePriority: "High" });
    const { ticket: edited } = succeeded(
      applyTicketAction(hazard, { action: "update", priority: "Low", note: "" }, as(ADMIN)),
    );
    expect(edited.basePriority).toBe("Low");
    expect(edited.priority).toBe("Critical");
  });

  it("passes an action's refusal through unchanged", () => {
    expect(applyTicketAction(ticket(), { action: "note", note: "" }, as(ROADS))).toEqual({
      ok: false,
      status: 400,
      error: "Note is empty.",
    });
  });

  it("copes with legacy tickets that have no history or messages", () => {
    const legacy = ticket({ history: undefined, messages: undefined });
    const { ticket: accepted } = succeeded(
      applyTicketAction(legacy, { action: "acknowledge", expectedFixDate: null, note: "" }, as(ROADS)),
    );
    expect(accepted.history).toHaveLength(1);
    expect(accepted.messages).toHaveLength(1);
  });
});

describe("timeline helpers", () => {
  it("appendHistory and appendMessage return new tickets", () => {
    const original = ticket({ history: undefined, messages: undefined });
    const withEntry = appendHistory(original, { status: "Reported", at: NOW, note: "n" });
    const withMessage = appendMessage(original, systemMessage("hello", NOW));
    expect(original.history).toBeUndefined();
    expect(withEntry.history).toEqual([{ status: "Reported", at: NOW, note: "n" }]);
    expect(withMessage.messages?.[0]).toMatchObject({ from: "system", text: "hello", at: NOW });
  });
});
