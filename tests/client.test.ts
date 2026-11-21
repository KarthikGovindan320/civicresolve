// Client-side helpers: the request builder that every screen shares, the staff
// work-queue rules, and display formatting.
import { afterEach, describe, expect, it, vi } from "vitest";
import { byTriageOrder, inQueue, queuesFor } from "@/app/staff/queues";
import type { StaffTicket } from "@/app/staff/types";
import { apiRequest, citizenRequest, staffRequest } from "@/lib/client/api";
import { formatDateTime, formatDay, languageName } from "@/lib/client/format";

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest", () => {
  it("sends the staff key and a JSON body", async () => {
    const fetchMock = stubFetch(200, { id: "CR-1" });
    const result = await staffRequest("/api/tickets/CR-1", "passcode", { method: "PATCH", json: { action: "note" } });

    expect(result).toEqual({ ok: true, data: { id: "CR-1" } });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/tickets/CR-1");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({ "x-staff-key": "passcode", "content-type": "application/json" });
    expect(init.body).toBe('{"action":"note"}');
  });

  it("sends form data without a content type, so the browser adds the multipart boundary", async () => {
    const fetchMock = stubFetch(200, {});
    const form = new FormData();
    await citizenRequest("/api/tickets/CR-1/confirm", "token", { method: "POST", form });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ "x-citizen-key": "token" });
    expect(init.body).toBe(form);
  });

  it("sends no credentials on a public request", async () => {
    const fetchMock = stubFetch(200, []);
    await apiRequest("/api/tickets");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});
  });

  it("returns the server's error message on an HTTP error", async () => {
    stubFetch(403, { error: "Not your department." });
    expect(await apiRequest("/api/tickets/CR-1")).toEqual({ ok: false, status: 403, error: "Not your department." });
  });

  it("leaves the error undefined when the server sent none, so callers can choose a fallback", async () => {
    stubFetch(401, { ok: false });
    expect(await apiRequest("/api/staff/session")).toEqual({ ok: false, status: 401, error: undefined });
  });
});

const ticket = (overrides: Partial<StaffTicket>): StaffTicket =>
  ({
    id: "CR-1",
    status: "Reported",
    priority: "Medium",
    reporterCount: 1,
    overdue: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }) as StaffTicket;

describe("staff work queues", () => {
  it("hides the admin-only queues from departments", () => {
    expect(queuesFor(false)).not.toContain("escalations");
    expect(queuesFor(false)).not.toContain("review");
    expect(queuesFor(true)).toEqual(expect.arrayContaining(["escalations", "review"]));
  });

  it("keeps unverified reports out of every queue except review", () => {
    const held = ticket({ verification: "unverified" });
    expect(inQueue("review", held)).toBe(true);
    expect(inQueue("todo", held)).toBe(false);
    expect(inQueue("all", held)).toBe(false);
  });

  it("splits resolved tickets by whether the citizen has answered", () => {
    const awaiting = ticket({ status: "Resolved", citizenConfirmation: "pending" });
    const closed = ticket({ status: "Resolved", citizenConfirmation: "confirmed" });
    expect(inQueue("awaiting", awaiting)).toBe(true);
    expect(inQueue("closed", awaiting)).toBe(false);
    expect(inQueue("closed", closed)).toBe(true);
  });

  it("escalates reopened tickets", () => {
    expect(inQueue("escalations", ticket({ status: "In Progress", reopenCount: 1 }))).toBe(true);
    expect(inQueue("escalations", ticket({}))).toBe(false);
  });

  it("orders by overdue, then priority, then reporters, then age", () => {
    const tickets = [
      ticket({ id: "newer", createdAt: "2026-01-02T00:00:00.000Z" }),
      ticket({ id: "older" }),
      ticket({ id: "popular", reporterCount: 4 }),
      ticket({ id: "critical", priority: "Critical" }),
      ticket({ id: "overdue", priority: "Low", overdue: true }),
    ];
    expect(tickets.sort(byTriageOrder).map((sorted) => sorted.id)).toEqual([
      "overdue",
      "critical",
      "popular",
      "older",
      "newer",
    ]);
  });
});

describe("display formatting", () => {
  it("shows timestamps in Indian Standard Time", () => {
    expect(formatDateTime("2026-01-01T06:21:00.000Z")).toMatch(/1 Jan 2026, 11:51 am/i);
  });

  it("formats a calendar day without shifting it across timezones", () => {
    expect(formatDay("2026-03-05")).toBe("5 Mar 2026");
  });

  it("names known languages and falls back to the code", () => {
    expect(languageName("ta")).toBe("Tamil");
    expect(languageName("fr")).toBe("FR");
  });
});
