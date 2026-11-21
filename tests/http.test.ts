// Shared HTTP helpers (src/lib/http.ts): the error-response shape, request
// parsing, request budgets and the "load the ticket, check who is asking" preamble.
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "civic-http-test-"));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSCODE = "http-admin";
process.env.DEPT_PASSCODES = JSON.stringify({ Sanitation: "http-sanitation" });
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const http = () => import("@/lib/http");
let ip = 0;
const request = (headers: Record<string, string> = {}) =>
  new Request("http://test/api", { headers: { "x-forwarded-for": `192.0.2.${++ip}`, ...headers } });
const BUDGET = { bucket: "http-test" };

describe("error responses", () => {
  it("answers { error } with the given status and headers", async () => {
    const { fail, failWith } = await http();
    const response = fail(400, "Bad input.", { "X-Extra": "1" });
    expect(response.status).toBe(400);
    expect(response.headers.get("X-Extra")).toBe("1");
    expect(await response.json()).toEqual({ error: "Bad input." });

    const fromFailure = failWith({ ok: false, status: 404, error: "Ticket not found." });
    expect(fromFailure.status).toBe(404);
    expect(fromFailure.headers.get("Retry-After")).toBeNull();
    expect(await fromFailure.json()).toEqual({ error: "Ticket not found." });
  });

  it("always tells a rate-limited caller when to retry", async () => {
    const { failWith, tooManyRequests } = await http();
    const response = tooManyRequests({ ok: false, retryAfterSec: 30 }, "Slow down.");
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(await response.json()).toEqual({ error: "Slow down." });
    const fromFailure = failWith({ ok: false, status: 429, error: "Wait.", retryAfterSec: 5 });
    expect(fromFailure.headers.get("Retry-After")).toBe("5");
  });
});

describe("baseUrl", () => {
  it("uses PUBLIC_BASE_URL without a trailing slash, or the request origin outside production", async () => {
    const { baseUrl } = await http();
    expect(baseUrl(new Request("https://city.example/api/tickets?x=1"))).toBe("https://city.example");
    vi.stubEnv("PUBLIC_BASE_URL", "https://civic.example/");
    expect(baseUrl(request())).toBe("https://civic.example");
  });

  it("never trusts the request's Host in production", async () => {
    const { baseUrl } = await http();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_BASE_URL", "");
    expect(() => baseUrl(new Request("https://attacker.example/api"))).toThrow("PUBLIC_BASE_URL must be set");
    vi.stubEnv("PUBLIC_BASE_URL", "https://civic.example");
    expect(baseUrl(new Request("https://attacker.example/api"))).toBe("https://civic.example");
  });
});

describe("request parsing", () => {
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request("http://test/api", { method: "POST", body, headers });
  const TextBody = z.object({ text: z.string() });

  it("parses a JSON body with a schema, and anything else as null", async () => {
    const { readJsonBody } = await http();
    expect(await readJsonBody(post('{"text":"hi"}'), TextBody)).toEqual({ text: "hi" });
    expect(await readJsonBody(post("not json"), TextBody)).toBeNull();
    expect(await readJsonBody(post("null"), TextBody)).toBeNull();
    expect(await readJsonBody(post('{"text":7}'), TextBody)).toBeNull();
  });

  it("reads a form, 400 for a body that is not one", async () => {
    const { readFormData } = await http();
    const form = new FormData();
    form.set("note", "hello");
    const parsed = await readFormData(post(form));
    expect(parsed.ok && parsed.form.get("note")).toBe("hello");
    expect(await readFormData(post("plain text"))).toEqual({
      ok: false,
      status: 400,
      error: "Expected multipart form data.",
    });
  });

  it("refuses a body declaring more than the largest allowed upload before reading it (413)", async () => {
    const { readFormData } = await http();
    const { MAX_FORM_BYTES } = await import("@/lib/uploads");
    const oversized = post(new FormData(), { "content-length": String(MAX_FORM_BYTES + 1) });
    expect(await readFormData(oversized)).toMatchObject({ ok: false, status: 413 });
    expect(oversized.bodyUsed).toBe(false);
  });

  it("trims and caps form text; missing fields and files read as empty", async () => {
    const { formText } = await http();
    const form = new FormData();
    form.set("note", "  hello world  ");
    form.set("photo", new Blob(["x"]));
    expect(formText(form, "note")).toBe("hello world");
    expect(formText(form, "note", 5)).toBe("hello");
    expect(formText(form, "missing")).toBe("");
    expect(formText(form, "photo")).toBe("");
  });
});

describe("request budgets", () => {
  it("allows `max` requests per client, then answers 429 with how long to wait", async () => {
    const { spendBudget } = await http();
    const from = { "x-forwarded-for": "192.0.2.250" };
    const budget = { bucket: "budget-test", max: 2, message: "Slow down." };
    expect(spendBudget(request(from), budget)).toBeNull();
    expect(spendBudget(request(from), budget)).toBeNull();
    expect(spendBudget(request(from), budget)).toMatchObject({ status: 429, error: "Slow down." });
    expect(spendBudget(request(), budget)).toBeNull(); // another client has its own budget
  });
});

describe("ticket access", () => {
  it("finds a ticket by id case-insensitively, and nothing for a malformed id", async () => {
    const { findTicket } = await http();
    const { store } = await import("@/lib/store");
    expect((await findTicket(store(), "cr-1001"))?.id).toBe("CR-1001");
    expect(await findTicket(store(), "../secrets")).toBeNull();
  });

  // CR-1001 is a seed ticket assigned to Public Works (Roads).
  it("staff: 401 without a passcode, 404 for an unknown ticket, 403 for another department", async () => {
    const { loadTicketForStaff } = await http();
    expect(await loadTicketForStaff(request(), "CR-1001", BUDGET)).toEqual({
      ok: false,
      status: 401,
      error: "Staff sign-in required.",
    });
    expect(await loadTicketForStaff(request({ "x-staff-key": "http-admin" }), "CR-0", BUDGET)).toEqual({
      ok: false,
      status: 404,
      error: "Ticket not found.",
    });
    const { store } = await import("@/lib/store");
    const seed = (await store().list()).find((ticket) => ticket.department !== "Sanitation");
    expect(seed).toBeDefined();
    const id = seed?.id ?? "";
    expect(await loadTicketForStaff(request({ "x-staff-key": "http-sanitation" }), id, BUDGET)).toEqual({
      ok: false,
      status: 403,
      error: "This ticket is assigned to another department.",
    });
    const allowed = await loadTicketForStaff(request({ "x-staff-key": "http-admin" }), id.toLowerCase(), BUDGET);
    expect(allowed).toMatchObject({ ok: true, role: { role: "admin" }, ticket: { id } });
  });

  it("staff: a used-up budget is a 429, checked before the ticket is looked up", async () => {
    const { loadTicketForStaff } = await http();
    const admin = { "x-staff-key": "http-admin", "x-forwarded-for": "192.0.2.251" };
    const budget = { bucket: "staff-budget-test", max: 1 };
    expect(await loadTicketForStaff(request(admin), "CR-0", budget)).toMatchObject({ status: 404 });
    expect(await loadTicketForStaff(request(admin), "CR-0", budget)).toMatchObject({ status: 429 });
  });

  it("citizen: 404 for an unknown ticket, 403 without a valid private link", async () => {
    const { loadTicketForReporter } = await http();
    const { store } = await import("@/lib/store");
    const { newReporter } = await import("@/lib/workflow");
    const [seed] = await store().list();
    const { token, reporter } = newReporter(null);
    await store().update(seed.id, (current) => ({ ...current, reporters: [reporter] }));

    expect(await loadTicketForReporter(request(), "CR-0", BUDGET)).toMatchObject({ ok: false, status: 404 });
    expect(await loadTicketForReporter(request({ "x-citizen-key": "wrong" }), seed.id, BUDGET)).toEqual({
      ok: false,
      status: 403,
      error: "Use the private link you received when reporting.",
    });
    expect(await loadTicketForReporter(request({ "x-citizen-key": token }), seed.id, BUDGET)).toMatchObject({
      ok: true,
      ticket: { id: seed.id },
    });
  });
});
