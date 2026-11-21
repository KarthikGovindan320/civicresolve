// End-to-end workflow through the real API route handlers:
// citizen submits → AI/rules classify → routed to a department → department
// accepts, messages the citizen, transfers or fixes (with an after photo) →
// citizen confirms or reopens. Also covers validation, rate limiting,
// role-based access control and privacy of reporter data.
// Runs against a throwaway local data directory and the rule-based classifier
// (no API key), so it is deterministic and needs no network. Rate limits are
// per client IP, so every request comes from its own address unless a test is
// about the limit itself.
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueOtp } from "@/lib/otp";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "civic-test-"));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSCODE = "test-admin";
process.env.DEPT_PASSCODES = JSON.stringify({
  "Public Works (Roads)": "roads-pass",
  Sanitation: "san-pass",
  "Electricity Board (TANGEDCO)": "elec-pass",
});
delete process.env.GEMINI_API_KEY;
delete process.env.SMTP_URL;
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let api: {
  list: typeof import("@/app/api/tickets/route");
  one: typeof import("@/app/api/tickets/[id]/route");
  resolve: typeof import("@/app/api/tickets/[id]/resolve/route");
  messages: typeof import("@/app/api/tickets/[id]/messages/route");
  confirm: typeof import("@/app/api/tickets/[id]/confirm/route");
};
beforeAll(async () => {
  api = {
    list: await import("@/app/api/tickets/route"),
    one: await import("@/app/api/tickets/[id]/route"),
    resolve: await import("@/app/api/tickets/[id]/resolve/route"),
    messages: await import("@/app/api/tickets/[id]/messages/route"),
    confirm: await import("@/app/api/tickets/[id]/confirm/route"),
  };
});

// ---- helpers ----
let ipCounter = 0;
const JPEG = new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], { type: "image/jpeg" });
// Every report is phone-verified by default (a fresh number each time, so the per-phone
// rate limit never interferes); pass verify=false to send one without verification.
let phoneCounter = 0;
function report(fields: Record<string, string | Blob>, ip = `10.0.0.${++ipCounter}`, verify = true) {
  const fd = new FormData();
  if (verify) {
    const phone = `+9198${String(++phoneCounter).padStart(8, "0")}`;
    const { code, challenge } = issueOtp(phone);
    fd.set("phone", phone);
    fd.set("otp", code);
    fd.set("otpChallenge", challenge);
  }
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://test/api/tickets", { method: "POST", body: fd, headers: { "x-forwarded-for": ip } });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const staff = (key: string) => ({ "x-staff-key": key });
const patch = (id: string, body: object, key?: string) =>
  api.one.PATCH(
    new Request("http://t", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...(key ? staff(key) : {}) },
    }),
    ctx(id),
  );
const message = (id: string, text: string, headers: Record<string, string>) =>
  api.messages.POST(
    new Request("http://t", {
      method: "POST",
      body: JSON.stringify({ text }),
      headers: { "content-type": "application/json", "x-forwarded-for": `20.0.0.${++ipCounter}`, ...headers },
    }),
    ctx(id),
  );
const multipart = (fields: Record<string, string | Blob>, headers: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://t", {
    method: "POST",
    body: fd,
    headers: { "x-forwarded-for": `30.0.0.${++ipCounter}`, ...headers },
  });
};
const tokenOf = (link: string) => new URL(link).searchParams.get("k")!;

describe("citizen reporting (POST /api/tickets)", () => {
  it("rejects a report with no location", async () => {
    const res = await api.list.POST(report({ title: "Pothole" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/location/i);
  });

  it("rejects an empty report and a bad email", async () => {
    expect((await api.list.POST(report({ lat: "12.9", lng: "79.1" }))).status).toBe(400);
    expect((await api.list.POST(report({ title: "x", lat: "12.9", lng: "79.1", email: "not-an-email" }))).status).toBe(
      400,
    );
  });

  it("rejects a non-image disguised as a photo", async () => {
    const fake = new Blob(["<script>alert(1)</script>"], { type: "image/jpeg" });
    const res = await api.list.POST(report({ title: "Pothole", lat: "12.9", lng: "79.1", image: fake }));
    expect(res.status).toBe(400);
  });

  it("creates a ticket routed to the right department, with a private link", async () => {
    const res = await api.list.POST(
      report({
        title: "Live wire hanging",
        description: "sparking near school",
        lat: "12.80",
        lng: "79.30",
        email: "me@example.com",
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.merged).toBe(false);
    expect(body.ticket.id).toMatch(/^CR-\d+$/);
    expect(body.ticket.category).toBe("Electrical Hazard");
    expect(body.ticket.priority).toBe("Critical"); // safety rule
    expect(body.ticket.department).toBe("Electricity Board (TANGEDCO)");
    expect(body.ticket.status).toBe("Reported");
    expect(body.privateLink).toMatch(/\/track\/CR-\d+\?k=/);
    // The response never echoes the email or reporter secrets
    expect(JSON.stringify(body.ticket)).not.toContain("me@example.com");
    expect(body.ticket.reporters).toBeUndefined();
  });

  it("merges a duplicate nearby and gives the second reporter their own link", async () => {
    const first = await (
      await api.list.POST(report({ title: "Pothole", description: "big pothole", lat: "12.70", lng: "79.40" }))
    ).json();
    const second = await (
      await api.list.POST(report({ title: "Pothole", description: "pothole here", lat: "12.70010", lng: "79.40" }))
    ).json();
    expect(second.merged).toBe(true);
    expect(second.ticket.id).toBe(first.ticket.id);
    expect(second.ticket.reporterCount).toBe(2);
    expect(tokenOf(second.privateLink)).not.toBe(tokenOf(first.privateLink));
  });

  it("rate-limits a single client that floods the endpoint, and says when to retry", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      // Each report is far from the others, so none is merged as a duplicate.
      const spot = { lat: String(11 + i * 0.01), lng: "78.0" };
      statuses.push((await api.list.POST(report({ title: "Pothole", ...spot }, "9.9.9.9"))).status);
    }
    expect(statuses).toEqual(Array(10).fill(201));
    const blocked = await api.list.POST(report({ title: "Pothole", lat: "11.5", lng: "78.0" }, "9.9.9.9"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("refuses a body declaring more than the largest allowed upload (413)", async () => {
    const huge = new Request("http://test/api/tickets", {
      method: "POST",
      body: new FormData(),
      headers: { "content-length": "999999999", "x-forwarded-for": `10.1.0.${++ipCounter}` },
    });
    expect((await api.list.POST(huge)).status).toBe(413);
  });

  it("rejects a voice note that is not audio, or too long", async () => {
    const loc = { lat: "12.95", lng: "79.05" };
    const notAudio = new Blob(["%PDF-1.7 not a recording at all"], { type: "audio/webm" });
    const bad = await api.list.POST(report({ title: "Pothole", ...loc, audio: notAudio }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/audio recording/i);
    const tooLong = new Blob([new Uint8Array(4_000_001)], { type: "audio/webm" });
    expect((await api.list.POST(report({ title: "Pothole", ...loc, audio: tooLong }))).status).toBe(413);
  });
});

describe("public tracking (GET)", () => {
  it("lists tickets newest first, without any private data", async () => {
    const list = await (await api.list.GET(new Request("http://t"))).json();
    expect(list.length).toBeGreaterThanOrEqual(15);
    expect(list[0].createdAt >= list[1].createdAt).toBe(true);
    const s = JSON.stringify(list);
    expect(s).not.toContain('"reporters"');
    expect(s).not.toContain('"messages"');
    expect(s).not.toContain("me@example.com");
  });

  it("looks up a ticket by ID case-insensitively, 404 for unknown", async () => {
    expect((await api.one.GET(new Request("http://t"), ctx("cr-1004"))).status).toBe(200);
    expect((await api.one.GET(new Request("http://t"), ctx("CR-0"))).status).toBe(404);
  });

  it("gives each anonymous client a generous but finite budget for the full list", async () => {
    const from = { headers: { "x-forwarded-for": "9.9.9.10" } };
    const statuses: number[] = [];
    for (let i = 0; i < 301; i++) statuses.push((await api.list.GET(new Request("http://t", from))).status);
    expect(statuses.slice(0, 300).every((status) => status === 200)).toBe(true);
    expect(statuses[300]).toBe(429);
    // Staff are not counted against the public budget.
    const signedIn = { headers: { ...from.headers, ...staff("test-admin") } };
    expect((await api.list.GET(new Request("http://t", signedIn))).status).toBe(200);
  });
});

// The tests in each of the next two blocks are consecutive steps in the life of one
// ticket, created in beforeAll: each step relies on the state the previous one left.
// LIFECYCLE pins that order explicitly: never concurrent, never shuffled.
const LIFECYCLE = { concurrent: false, shuffle: false };
describe("department workflow: accept → message → fix → citizen confirms", LIFECYCLE, () => {
  let id = "";
  let token = "";
  beforeAll(async () => {
    const body = await (
      await api.list.POST(
        report({ title: "Garbage bin overflowing", description: "garbage everywhere", lat: "12.60", lng: "79.50" }),
      )
    ).json();
    id = body.ticket.id;
    token = tokenOf(body.privateLink);
  });

  it("is invisible to actions from other departments (403) and anonymous users (401)", async () => {
    expect((await patch(id, { action: "acknowledge" })).status).toBe(401);
    expect((await patch(id, { action: "acknowledge" }, "roads-pass")).status).toBe(403);
  });

  it("the owning department accepts it with a promised date", async () => {
    const t = await (await patch(id, { action: "acknowledge", expectedFixDate: "2099-01-01" }, "san-pass")).json();
    expect(t.status).toBe("In Progress");
    expect(t.expectedFixDate).toBe("2099-01-01");
    expect(t.acknowledgedAt).toBeTruthy();
  });

  it("department and citizen exchange messages; strangers can't", async () => {
    expect((await message(id, "Crew coming tomorrow", staff("san-pass"))).status).toBe(200);
    const t = await (await message(id, "Thanks!", { "x-citizen-key": token })).json();
    expect(t.messages.map((m: { from: string }) => m.from)).toEqual(expect.arrayContaining(["department", "citizen"]));
    expect((await message(id, "spam", { "x-citizen-key": "wrong-token" })).status).toBe(403);
    expect((await message(id, "spam", staff("roads-pass"))).status).toBe(403);
  });

  it("the citizen sees the conversation only with their token", async () => {
    const pub = await (await api.one.GET(new Request("http://t"), ctx(id))).json();
    const priv = await (
      await api.one.GET(new Request("http://t", { headers: { "x-citizen-key": token } }), ctx(id))
    ).json();
    expect(pub.messages).toBeUndefined();
    expect(priv.messages.length).toBeGreaterThan(0);
  });

  it("a department can't mark it fixed without an after photo", async () => {
    const res = await api.resolve.POST(multipart({ note: "cleared" }, staff("san-pass")), ctx(id));
    expect(res.status).toBe(400);
  });

  it("marks it fixed with proof → Resolved, awaiting citizen confirmation", async () => {
    const t = await (
      await api.resolve.POST(multipart({ note: "Bin emptied", photo: JPEG }, staff("san-pass")), ctx(id))
    ).json();
    expect(t.status).toBe("Resolved");
    expect(t.citizenConfirmation).toBe("pending");
    expect(t.resolution.hasPhoto).toBe(true);
    expect(["fixed", "not_fixed", "unclear"]).toContain(t.resolution.aiVerdict);
  });

  it("only the citizen can confirm, then it's closed", async () => {
    expect(
      (await api.confirm.POST(multipart({ decision: "confirm" }, { "x-citizen-key": "nope" }), ctx(id))).status,
    ).toBe(403);
    const t = await (
      await api.confirm.POST(multipart({ decision: "confirm" }, { "x-citizen-key": token }), ctx(id))
    ).json();
    expect(t.citizenConfirmation).toBe("confirmed");
    expect(t.history.map((h: { status: string }) => h.status)).toEqual([
      "Reported",
      "In Progress",
      "Resolved",
      "Resolved",
    ]);
  });
});

describe("transfer and reopen", LIFECYCLE, () => {
  let id = "";
  let token = "";
  beforeAll(async () => {
    const body = await (
      await api.list.POST(
        report({ title: "Pothole on main road", description: "deep pothole", lat: "12.50", lng: "79.60" }),
      )
    ).json();
    id = body.ticket.id;
    token = tokenOf(body.privateLink);
  });

  it("transfers need a reason and move the ticket to the other department's queue", async () => {
    expect((await patch(id, { action: "transfer", department: "Sanitation" }, "roads-pass")).status).toBe(400);
    const t = await (
      await patch(
        id,
        { action: "transfer", department: "Sanitation", note: "It's debris, not a pothole" },
        "roads-pass",
      )
    ).json();
    expect(t.department).toBe("Sanitation");
    expect(t.transfers).toBe(1);
    // the old department has lost access
    expect((await patch(id, { action: "acknowledge" }, "roads-pass")).status).toBe(403);
  });

  it("the citizen can reopen a claimed fix, which returns it to In Progress", async () => {
    await patch(id, { action: "acknowledge" }, "san-pass");
    await api.resolve.POST(multipart({ note: "Cleared", photo: JPEG }, staff("san-pass")), ctx(id));
    expect(
      (await api.confirm.POST(multipart({ decision: "reopen" }, { "x-citizen-key": token }), ctx(id))).status,
    ).toBe(400); // note required
    const t = await (
      await api.confirm.POST(
        multipart({ decision: "reopen", note: "Still there" }, { "x-citizen-key": token }),
        ctx(id),
      )
    ).json();
    expect(t.status).toBe("In Progress");
    expect(t.citizenConfirmation).toBe("reopened");
    expect(t.reopenCount).toBe(1);
  });
});

describe("city admin overrides", () => {
  it("refuses overrides from departments, allows them for the admin", async () => {
    expect((await patch("CR-1010", { action: "update", status: "Resolved" }, "san-pass")).status).toBe(403);
    const t = await (
      await patch("CR-1007", { action: "update", status: "In Progress", note: "Crew assigned" }, "test-admin")
    ).json();
    expect(t.status).toBe("In Progress");
  });

  it("ignores invalid values instead of writing them", async () => {
    const t = await (
      await patch("CR-1010", { action: "update", status: "Deleted", category: "Aliens" }, "test-admin")
    ).json();
    expect(t.status).toBe("Reported");
    expect(t.category).toBe("Garbage");
  });

  it("cannot downgrade a safety-critical issue", async () => {
    const t = await (await patch("CR-1008", { action: "update", priority: "Low" }, "test-admin")).json();
    expect(t.priority).toBe("Critical"); // open manhole
  });

  it("rejects a body without a known action", async () => {
    const res = await patch("CR-1008", { priority: "Low" }, "test-admin");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown action." });
  });

  it("accepts a lower-case ticket id", async () => {
    expect((await patch("cr-1008", { action: "note", note: "Barricade placed" }, "test-admin")).status).toBe(200);
  });

  it("caps staff actions per client, before the ticket is even looked up", async () => {
    const noteOn = (id: string) =>
      api.one.PATCH(
        new Request("http://t", {
          method: "PATCH",
          body: JSON.stringify({ action: "note", note: "x" }),
          headers: { ...staff("test-admin"), "x-forwarded-for": "9.9.9.11" },
        }),
        ctx(id),
      );
    await expectBudget(120, () => noteOn("CR-0"));
  });
});

// =============================================================================
// Anti-spam: phone OTP verification, the separate "unverified" bucket,
// and the guarantee that phone numbers never leak.
// =============================================================================
describe("phone verification (OTP) and the unverified review bucket", () => {
  let otpApi: typeof import("@/app/api/otp/route");
  beforeAll(async () => {
    otpApi = await import("@/app/api/otp/route");
  });
  const otpReq = (phone: string, ip = `40.0.0.${++ipCounter}`) =>
    new Request("http://t/api/otp", {
      method: "POST",
      body: JSON.stringify({ phone }),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    });
  const loc = { lat: "12.40", lng: "79.70" };

  it("issues a code for a valid Indian mobile (stub mode returns it), rejects invalid numbers", async () => {
    expect((await otpApi.POST(otpReq("12345"))).status).toBe(400);
    const body = await (await otpApi.POST(otpReq("098765 43210"))).json();
    expect(body.phone).toBe("+919876543210"); // normalised
    expect(body.stub).toBe(true);
    expect(body.devCode).toMatch(/^\d{6}$/);
    expect(body.challenge).toBeTruthy();
  });

  it("accepts the right code and refuses a wrong code, another number, or a forged challenge", async () => {
    const { devCode, challenge, phone } = await (await otpApi.POST(otpReq("9123456780"))).json();
    const send = (p: string, code: string, ch: string) =>
      api.list.POST(report({ title: "Pothole", ...loc, phone: p, otp: code, otpChallenge: ch }, undefined, false));
    const wrong = devCode === "000000" ? "111111" : "000000";
    expect((await send(phone, wrong, challenge)).status).toBe(401);
    expect((await send("+919999999999", devCode, challenge)).status).toBe(401); // code bound to the number
    expect((await send(phone, devCode, `${Date.now() + 60_000}.forged`)).status).toBe(401);
    expect((await send(phone, devCode, challenge)).status).toBe(201);
  });

  it("never exposes the verified phone number in any response", async () => {
    const { devCode, challenge, phone } = await (await otpApi.POST(otpReq("9000012345"))).json();
    const created = await (
      await api.list.POST(
        report(
          {
            title: "Garbage bin overflowing",
            description: "garbage",
            lat: "12.31",
            lng: "79.81",
            phone,
            otp: devCode,
            otpChallenge: challenge,
          },
          undefined,
          false,
        ),
      )
    ).json();
    const views = [
      JSON.stringify(created),
      JSON.stringify(await (await api.list.GET(new Request("http://t", { headers: staff("test-admin") }))).json()),
      JSON.stringify(
        await (
          await api.one.GET(new Request("http://t", { headers: staff("san-pass") }), ctx(created.ticket.id))
        ).json(),
      ),
    ];
    for (const v of views) expect(v).not.toContain("9000012345");
  });

  it("keeps a report sent WITHOUT verification in a separate bucket until the admin approves it", async () => {
    const res = await api.list.POST(
      report(
        { title: "Garbage dumped", description: "garbage pile on road", lat: "12.20", lng: "79.90" },
        undefined,
        false,
      ),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.unverified).toBe(true);
    expect(body.aiSource).toBe("fallback"); // no Gemini spend on unverified reports
    const id = body.ticket.id;
    const ids = async (headers: Record<string, string> = {}) =>
      ((await (await api.list.GET(new Request("http://t", { headers }))).json()) as { id: string }[]).map((t) => t.id);

    // Held: hidden from the public and the department, visible to the admin and to the reporter.
    expect(await ids()).not.toContain(id);
    expect(await ids(staff("san-pass"))).not.toContain(id);
    expect(await ids(staff("test-admin"))).toContain(id);
    expect((await api.one.GET(new Request("http://t"), ctx(id))).status).toBe(404);
    expect(
      (await api.one.GET(new Request("http://t", { headers: { "x-citizen-key": tokenOf(body.privateLink) } }), ctx(id)))
        .status,
    ).toBe(200);
    expect((await patch(id, { action: "acknowledge" }, "san-pass")).status).toBe(403);
    expect((await patch(id, { action: "review", decision: "approve" }, "san-pass")).status).toBe(403);

    // Approved: it enters the department's normal queue and becomes public.
    const approved = await (await patch(id, { action: "review", decision: "approve" }, "test-admin")).json();
    expect(approved.verification).toBe("approved");
    expect(await ids()).toContain(id);
    expect((await patch(id, { action: "acknowledge" }, "san-pass")).status).toBe(200);
  });

  it("a rejected unverified report stays stored but hidden from everyone", async () => {
    const body = await (
      await api.list.POST(
        report({ title: "asdf", description: "test test", lat: "12.21", lng: "79.91" }, undefined, false),
      )
    ).json();
    const res = await patch(
      body.ticket.id,
      { action: "review", decision: "reject", note: "Not a civic issue" },
      "test-admin",
    );
    expect((await res.json()).verification).toBe("rejected");
    const adminIds = (
      (await (await api.list.GET(new Request("http://t", { headers: staff("test-admin") }))).json()) as { id: string }[]
    ).map((t) => t.id);
    expect(adminIds).not.toContain(body.ticket.id);
  });

  it("gives unverified reports a much tighter rate limit per device", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push(
        (
          await api.list.POST(
            report({ title: "spam", description: "spam", lat: "12.1", lng: "79.1" }, "8.8.8.8", false),
          )
        ).status,
      );
    expect(statuses.slice(0, 3)).toEqual([201, 201, 201]);
    expect(statuses[3]).toBe(429);
  });
});

// =============================================================================
// Route branches beyond the happy path: proof of fix, conversation and the
// citizen's answer, including each endpoint's own request budget.
// =============================================================================

/** A fresh ticket (routed to Sanitation) and its reporter's private-link token. */
async function newGarbageTicket(lat: string) {
  const body = await (
    await api.list.POST(report({ title: "Garbage dumped", description: "garbage pile", lat, lng: "79.95" }))
  ).json();
  return { id: body.ticket.id as string, token: tokenOf(body.privateLink) };
}
/** `count` requests from one client: every status but the last, then the last response. */
async function flood(count: number, send: () => Promise<Response>) {
  const statuses: number[] = [];
  for (let i = 1; i < count; i++) statuses.push((await send()).status);
  return { statuses, last: await send() };
}
/**
 * Send `budget` + 1 requests for an unknown ticket from one client: the budget
 * is spent before the ticket is looked up, so all but the last are 404s, and the
 * last is a 429 that says when to retry.
 */
async function expectBudget(budget: number, send: () => Promise<Response>) {
  const { statuses, last } = await flood(budget + 1, send);
  expect(statuses).toEqual(Array(budget).fill(404));
  expect(last.status).toBe(429);
  expect(Number(last.headers.get("Retry-After"))).toBeGreaterThan(0);
}

describe("proof of fix (POST /api/tickets/[id]/resolve)", () => {
  it("lets the city admin close without a photo, recorded as unchecked", async () => {
    const { id } = await newGarbageTicket("12.051");
    const res = await api.resolve.POST(
      multipart({ note: "Duplicate of an older report" }, staff("test-admin")),
      ctx(id),
    );
    expect(res.status).toBe(200);
    const t = await res.json();
    expect(t.status).toBe("Resolved");
    expect(t.resolution).toMatchObject({ hasPhoto: false, aiVerdict: "unclear", by: "City Admin" });
    expect(t.resolution.aiReason).toBe("No after-photo was provided.");
  });

  it("needs a note (400) and refuses a ticket that is already resolved (409)", async () => {
    const { id } = await newGarbageTicket("12.052");
    const noNote = await api.resolve.POST(multipart({ photo: JPEG }, staff("san-pass")), ctx(id));
    expect(noNote.status).toBe(400);
    expect((await noNote.json()).error).toMatch(/describe what was done/i);
    expect(
      (await api.resolve.POST(multipart({ note: "Cleared", photo: JPEG }, staff("san-pass")), ctx(id))).status,
    ).toBe(200);
    const again = await api.resolve.POST(multipart({ note: "Cleared again", photo: JPEG }, staff("san-pass")), ctx(id));
    expect(again.status).toBe(409);
  });

  it("caps resolves per client, since each one may call Gemini", async () => {
    const send = () =>
      api.resolve.POST(
        multipart({ note: "x" }, { ...staff("test-admin"), "x-forwarded-for": "9.9.9.12" }),
        ctx("CR-0"),
      );
    await expectBudget(30, send);
  });
});

describe("conversation (POST /api/tickets/[id]/messages)", () => {
  it("rejects an empty message (400) and an unknown ticket (404)", async () => {
    const empty = await message("CR-1004", "   ", staff("test-admin"));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "Message is empty." });
    expect((await message("CR-0", "Hello", staff("test-admin"))).status).toBe(404);
  });

  it("accepts a lower-case ticket id and keeps the author's role", async () => {
    const t = await (await message("cr-1004", "Crew on the way", staff("test-admin"))).json();
    expect(t.messages.at(-1)).toMatchObject({ from: "admin", text: "Crew on the way" });
  });

  it("caps messages per client", async () => {
    const send = () =>
      api.messages.POST(
        new Request("http://t", {
          method: "POST",
          body: JSON.stringify({ text: "hello" }),
          headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.13" },
        }),
        ctx("CR-0"),
      );
    await expectBudget(10, send);
  });
});

describe("citizen's answer (POST /api/tickets/[id]/confirm)", () => {
  it("answers 409 while the fix hasn't been reported, and 400 for an unknown decision", async () => {
    const { id, token } = await newGarbageTicket("12.053");
    const citizen = { "x-citizen-key": token };
    expect((await api.confirm.POST(multipart({ decision: "confirm" }, citizen), ctx(id))).status).toBe(409);
    await api.resolve.POST(multipart({ note: "Cleared", photo: JPEG }, staff("san-pass")), ctx(id));
    const unknown = await api.confirm.POST(multipart({ decision: "maybe" }, citizen), ctx(id.toLowerCase()));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toMatch(/confirm' or 'reopen/);
  });

  it("caps answers per client", async () => {
    const send = () =>
      api.confirm.POST(multipart({ decision: "confirm" }, { "x-forwarded-for": "9.9.9.14" }), ctx("CR-0"));
    await expectBudget(10, send);
  });
});

describe("one-time codes (POST /api/otp) budgets", () => {
  let otpApi: typeof import("@/app/api/otp/route");
  beforeAll(async () => {
    otpApi = await import("@/app/api/otp/route");
  });
  const ask = (phone: string, ip: string) =>
    otpApi.POST(
      new Request("http://t/api/otp", {
        method: "POST",
        body: JSON.stringify({ phone }),
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
      }),
    );

  it("limits how many codes one device can request, for any numbers", async () => {
    let n = 0;
    const { statuses, last } = await flood(11, () => ask(`93000000${String(++n).padStart(2, "0")}`, "9.9.9.15"));
    expect(statuses).toEqual(Array(10).fill(200));
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("limits how many codes one number can receive, from any devices", async () => {
    let n = 0;
    const { statuses, last } = await flood(11, () => ask("9400000001", `9.9.10.${++n}`));
    expect(statuses).toEqual(Array(10).fill(200));
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("rejects a body without a phone number", async () => {
    const res = await otpApi.POST(
      new Request("http://t/api/otp", { method: "POST", body: "{}", headers: { "x-forwarded-for": "9.9.9.16" } }),
    );
    expect(res.status).toBe(400);
  });
});
