// Smaller API routes: staff sign-in check and photo serving.
import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "civic-misc-"));
process.env.ADMIN_PASSCODE = "misc-admin";
process.env.DEPT_PASSCODES = JSON.stringify({ Sanitation: "misc-san" });
delete process.env.GEMINI_API_KEY;

let session: typeof import("@/app/api/staff/session/route");
let image: typeof import("@/app/api/tickets/[id]/image/route");
let tickets: typeof import("@/app/api/tickets/route");
let otp: typeof import("@/lib/otp");
let workflow: typeof import("@/lib/workflow");
beforeAll(async () => {
  session = await import("@/app/api/staff/session/route");
  image = await import("@/app/api/tickets/[id]/image/route");
  tickets = await import("@/app/api/tickets/route");
  otp = await import("@/lib/otp");
  workflow = await import("@/lib/workflow");
});

const withKey = (key?: string) =>
  new Request("http://t/api/staff/session", { headers: key ? { "x-staff-key": key } : {} });

describe("GET /api/staff/session", () => {
  it("rejects a missing or wrong passcode", async () => {
    expect((await session.GET(withKey())).status).toBe(401);
    expect((await session.GET(withKey("nope"))).status).toBe(401);
  });

  it("identifies the admin and a department, and reports which integrations are live", async () => {
    const admin = await (await session.GET(withKey("misc-admin"))).json();
    expect(admin).toMatchObject({ ok: true, role: "admin", gemini: false, email: false });
    const dept = await (await session.GET(withKey("misc-san"))).json();
    expect(dept).toMatchObject({ ok: true, role: "department", department: "Sanitation" });
  });
});

describe("GET /api/tickets/[id]/image", () => {
  const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4];
  let ip = 0;

  /** Submit a report with a photo; verified reports go public, unverified ones are held for review. */
  async function reportWithPhoto(verified: boolean) {
    const form = new FormData();
    form.set("title", "Garbage pile near the temple");
    form.set("description", "Not collected for four days.");
    // Each report gets its own spot far from the seed data, so it never merges into another ticket.
    form.set("lat", String(13.5 + ++ip * 0.01));
    form.set("lng", "79.6");
    form.set("image", new Blob([Uint8Array.from(JPEG_BYTES)], { type: "image/jpeg" }));
    if (verified) {
      const phone = `+9197${String(++ip).padStart(8, "0")}`;
      const { code, challenge } = otp.issueOtp(phone);
      form.set("phone", phone);
      form.set("otp", code);
      form.set("otpChallenge", challenge);
    }
    const res = await tickets.POST(
      new Request("http://t/api/tickets", {
        method: "POST",
        body: form,
        headers: { "x-forwarded-for": `70.0.0.${++ip}` },
      }),
    );
    const body = await res.json();
    return { id: body.ticket.id as string, token: new URL(body.privateLink).searchParams.get("k")! };
  }
  const fetchImage = (id: string, query = "") =>
    image.GET(new Request(`http://t/api/tickets/${id}/image${query}`), { params: Promise.resolve({ id }) } as never);

  it("serves a public ticket's photo with its MIME type and a public cache header", async () => {
    const { id } = await reportWithPhoto(true);
    const res = await fetchImage(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toMatch(/^public/);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual(JPEG_BYTES);
  });

  it("hides a held ticket's photo unless the request carries the signature or the reporter's token", async () => {
    const { id, token } = await reportWithPhoto(false);
    expect((await fetchImage(id)).status).toBe(404); // guessing the id is not enough
    expect((await fetchImage(id, "?s=forged-signature")).status).toBe(404);
    expect((await fetchImage(id, "?k=wrong-token")).status).toBe(404);
    // A signature for another photo of the same ticket doesn't unlock this one.
    expect((await fetchImage(id, `?s=${workflow.photoSignature(id, "after")}`)).status).toBe(404);

    const signed = await fetchImage(id, `?s=${workflow.photoSignature(id, "before")}`);
    expect(signed.status).toBe(200);
    expect(signed.headers.get("cache-control")).toMatch(/^private/);
    expect((await fetchImage(id, `?k=${token}`)).status).toBe(200);
  });

  it("builds signed URLs only for held tickets", () => {
    expect(workflow.photoUrl({ id: "CR-1" }, "before")).toBe("/api/tickets/CR-1/image?v=before");
    const held = workflow.photoUrl({ id: "CR-2", verification: "unverified" }, "before");
    expect(held).toContain(`s=${workflow.photoSignature("CR-2", "before")}`);
  });

  it("returns 404 for unknown tickets, bad ids and variants outside the allow-list", async () => {
    const { id } = await reportWithPhoto(true);
    expect((await fetchImage(id, "?v=reopen")).status).toBe(404);
    expect((await fetchImage("CR-404")).status).toBe(404);
    expect((await fetchImage("../secrets")).status).toBe(404);
    expect((await fetchImage(id, "?v=constructor")).status).toBe(404);
    expect((await fetchImage(id, "?v=toString")).status).toBe(404);
  });
});
