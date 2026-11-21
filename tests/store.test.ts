// =============================================================================
// [TESTING] Regression tests for two bugs found by clicking through the running app in a real
// browser, kept here so they can never come back.
//   1. FileStore must survive its data directory disappearing while the server runs
//      (it used to return HTTP 500 on every write, forever).
//   2. Promised fix dates must be shown as "24 Nov 2026", not raw ISO "2026-11-24".
// =============================================================================
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { fmtDay } from "@/lib/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "civic-store-"));
process.env.DATA_DIR = dir;
process.env.STORE = "file";

describe("FileStore resilience", () => {
  it("re-creates a deleted data directory instead of failing every later write", async () => {
    const { store } = await import("@/lib/store");
    const db = store();
    const t = (await db.list())[0]; // first call seeds the store and caches it in memory
    expect(t).toBeTruthy();

    fs.rmSync(dir, { recursive: true, force: true }); // simulate ./data being wiped under a live server

    await expect(db.put({ ...t, title: "edited after wipe" })).resolves.toBeUndefined();
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "tickets.json"), "utf8"));
    expect(onDisk.find((x: { id: string }) => x.id === t.id).title).toBe("edited after wipe");

    // And a failure must never poison the write queue: the next write still succeeds.
    await expect(db.put({ ...t, title: "second write" })).resolves.toBeUndefined();
  });
});

describe("fmtDay", () => {
  it("formats a plain ISO day in a human style, independent of server timezone", () => {
    expect(fmtDay("2026-11-24")).toBe("24 Nov 2026");
    expect(fmtDay("2026-01-05")).toBe("5 Jan 2026");
  });
});
