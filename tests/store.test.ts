// =============================================================================
// The local file store (src/lib/store.ts) and the stored-record schema
// (src/lib/records.ts): data integrity under failure and under concurrency.
//   • A deleted data directory is re-created; a corrupt file is never overwritten.
//   • Ids are never handed out twice and simultaneous updates are all kept.
//   • Records that don't match the domain model are rejected, not trusted.
// =============================================================================
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseStoredImage, parseTicket } from "@/lib/records";

let dir = "";
const createdDirs: string[] = [];
const ticketsFile = () => path.join(dir, "tickets.json");
const globalWithStore: typeof globalThis & { __civicStore?: unknown } = globalThis;

/** A brand-new FileStore over an empty temporary data directory. */
async function freshStore() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "civic-store-"));
  createdDirs.push(dir);
  process.env.DATA_DIR = dir;
  process.env.STORE = "file";
  globalWithStore.__civicStore = undefined;
  const { store } = await import("@/lib/store");
  return store();
}

beforeEach(() => {
  globalWithStore.__civicStore = undefined;
});
afterAll(() => {
  for (const created of createdDirs) fs.rmSync(created, { recursive: true, force: true });
});

describe("FileStore resilience", () => {
  it("re-creates a deleted data directory instead of failing every later write", async () => {
    const db = await freshStore();
    const t = (await db.list())[0]; // first call seeds the store and caches it in memory
    expect(t).toBeTruthy();

    fs.rmSync(dir, { recursive: true, force: true }); // simulate ./data being wiped under a live server

    await expect(db.update(t.id, (current) => ({ ...current, title: "edited after wipe" }))).resolves.toMatchObject({
      title: "edited after wipe",
    });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "tickets.json"), "utf8"));
    expect(onDisk.find((x: { id: string }) => x.id === t.id).title).toBe("edited after wipe");

    // And a failure must never poison the write queue: the next write still succeeds.
    await expect(db.update(t.id, (current) => ({ ...current, title: "second write" }))).resolves.toMatchObject({
      title: "second write",
    });
  });

  it("refuses to start from a corrupt file instead of overwriting it with demo data", async () => {
    const db = await freshStore();
    fs.writeFileSync(ticketsFile(), "{ not json");
    await expect(db.list()).rejects.toThrow();
    expect(fs.readFileSync(ticketsFile(), "utf8")).toBe("{ not json");
  });

  it("skips stored records that no longer match the ticket model", async () => {
    const db = await freshStore();
    const [valid] = await db.list();
    fs.writeFileSync(ticketsFile(), JSON.stringify([valid, { id: "CR-9000", status: "Lost" }]));
    globalWithStore.__civicStore = undefined;
    const { store } = await import("@/lib/store");
    expect((await store().list()).map((ticket) => ticket.id)).toEqual([valid.id]);
  });

  it("returns null for a missing photo and the stored photo otherwise", async () => {
    const db = await freshStore();
    expect(await db.getImage("CR-1001")).toBeNull();
    await db.putImage("CR-1001", { mimeType: "image/png", data: "iVBORw0KGgo=" });
    expect(await db.getImage("CR-1001")).toEqual({ mimeType: "image/png", data: "iVBORw0KGgo=" });
  });
});

describe("FileStore concurrency", () => {
  it("never hands out the same id to two reports created at the same moment", async () => {
    const db = await freshStore();
    const [template] = await db.list();
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, index) => db.create((id) => ({ ...template, id, title: `Report ${index}` }))),
    );
    const ids = created.map((ticket) => ticket.id);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) expect(await db.get(id)).not.toBeNull();
  });

  it("keeps every change when several updates to one ticket overlap", async () => {
    const db = await freshStore();
    const [{ id }] = await db.list();
    await Promise.all(
      ["a", "b", "c"].map((note) =>
        db.update(id, (current) => ({ ...current, adminNotes: [...current.adminNotes, note] })),
      ),
    );
    expect((await db.get(id))?.adminNotes.slice(-3)).toEqual(["a", "b", "c"]);
  });

  it("saves nothing when the change declines, and nothing for an unknown ticket", async () => {
    const db = await freshStore();
    const [before] = await db.list();
    expect(await db.update(before.id, () => null)).toBeNull();
    expect(await db.get(before.id)).toEqual(before);
    expect(await db.update("CR-0000", (current) => current)).toBeNull();
  });
});

describe("stored-record schema", () => {
  it("accepts a well-formed ticket and rejects one with values outside the domain", async () => {
    const [valid] = await (await freshStore()).list();
    expect(parseTicket(valid)).toEqual(valid);
    expect(parseTicket({ ...valid, status: "Closed" })).toBeNull();
    expect(parseTicket({ ...valid, reporterCount: 0 })).toBeNull();
    expect(parseTicket("CR-1001")).toBeNull();
  });

  it("accepts only photos with a type and data", () => {
    expect(parseStoredImage({ mimeType: "image/jpeg", data: "abc" })).toEqual({ mimeType: "image/jpeg", data: "abc" });
    expect(parseStoredImage({ data: "abc" })).toBeNull();
  });
});
