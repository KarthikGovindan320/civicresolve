// Shared HTTP helpers (src/lib/http.ts): the error-response shape, request
// parsing and the "load the ticket, check who is asking" preamble.
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "civic-http-test-"));
process.env.ADMIN_PASSCODE = "http-admin";
process.env.DEPT_PASSCODES = JSON.stringify({ Sanitation: "http-sanitation" });

const http = () => import("@/lib/http");
const request = (headers: Record<string, string> = {}) => new Request("http://test/api", { headers });

describe("fail", () => {
  it("answers { error } with the given status and headers", async () => {
    const { fail, failWith } = await http();
    const response = fail(429, "Slow down.", { "Retry-After": "30" });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(await response.json()).toEqual({ error: "Slow down." });

    const fromFailure = failWith({ ok: false, status: 404, error: "Ticket not found." });
    expect(fromFailure.status).toBe(404);
    expect(await fromFailure.json()).toEqual({ error: "Ticket not found." });
  });
});

describe("baseUrl", () => {
  it("uses the request origin, or PUBLIC_BASE_URL without a trailing slash", async () => {
    const { baseUrl } = await http();
    expect(baseUrl(new Request("https://city.example/api/tickets?x=1"))).toBe("https://city.example");
    process.env.PUBLIC_BASE_URL = "https://civic.example/";
    try {
      expect(baseUrl(request())).toBe("https://civic.example");
    } finally {
      delete process.env.PUBLIC_BASE_URL;
    }
  });
});

describe("request parsing", () => {
  const post = (body: string) => new Request("http://test/api", { method: "POST", body });

  it("reads a JSON object, and anything else as an empty object", async () => {
    const { readJsonBody } = await http();
    expect(await readJsonBody(post('{"text":"hi"}'))).toEqual({ text: "hi" });
    expect(await readJsonBody(post("not json"))).toEqual({});
    expect(await readJsonBody(post("null"))).toEqual({});
    expect(await readJsonBody(post('"text"'))).toEqual({});
  });

  it("returns null for a body that is not a form", async () => {
    const { readFormData } = await http();
    expect(await readFormData(post("plain text"))).toBeNull();
  });

  it("trims and caps form text", async () => {
    const { formText } = await http();
    const form = new FormData();
    form.set("note", "  hello world  ");
    expect(formText(form, "note")).toBe("hello world");
    expect(formText(form, "note", 5)).toBe("hello");
    expect(formText(form, "missing")).toBe("");
  });
});

describe("ticket access", () => {
  // CR-1001 is a seed ticket assigned to Public Works (Roads).
  it("staff: 401 without a passcode, 404 for an unknown ticket, 403 for another department", async () => {
    const { loadTicketForStaff } = await http();
    expect(await loadTicketForStaff(request(), "CR-1001")).toEqual({
      ok: false,
      status: 401,
      error: "Staff sign-in required.",
    });
    expect(await loadTicketForStaff(request({ "x-staff-key": "http-admin" }), "CR-0")).toEqual({
      ok: false,
      status: 404,
      error: "Ticket not found.",
    });
    const { store } = await import("@/lib/store");
    const seed = (await store().list()).find((ticket) => ticket.department !== "Sanitation");
    expect(seed).toBeDefined();
    expect(await loadTicketForStaff(request({ "x-staff-key": "http-sanitation" }), seed?.id ?? "")).toEqual({
      ok: false,
      status: 403,
      error: "This ticket is assigned to another department.",
    });
    const allowed = await loadTicketForStaff(request({ "x-staff-key": "http-admin" }), seed?.id ?? "");
    expect(allowed).toMatchObject({ ok: true, role: { role: "admin" }, ticket: { id: seed?.id } });
  });

  it("citizen: 404 for an unknown ticket, 403 without a valid private link", async () => {
    const { loadTicketForReporter } = await http();
    const { store } = await import("@/lib/store");
    const { newReporter } = await import("@/lib/workflow");
    const [seed] = await store().list();
    const { token, reporter } = newReporter(null);
    await store().put({ ...seed, reporters: [reporter] });

    expect(await loadTicketForReporter(request(), "CR-0")).toMatchObject({ ok: false, status: 404 });
    expect(await loadTicketForReporter(request({ "x-citizen-key": "wrong" }), seed.id)).toEqual({
      ok: false,
      status: 403,
      error: "Use the private link you received when reporting.",
    });
    expect(await loadTicketForReporter(request({ "x-citizen-key": token }), seed.id)).toMatchObject({
      ok: true,
      ticket: { id: seed.id },
    });
  });
});
