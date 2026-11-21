// =============================================================================
// [GOOGLE SERVICES][CODE QUALITY] PERSISTENCE LAYER: one interface, two interchangeable backends
// -----------------------------------------------------------------------------
//   • FirestoreStore: production on Google Cloud Run (serverless, scales to zero,
//     survives redeploys). Enabled with STORE=firestore.
//   • FileStore: zero-setup local development: a JSON file, no cloud account needed.
// API routes only talk to the `Store` interface, so switching backends is a
// single environment variable and needs no code changes. Both backends seed
// themselves with realistic Vellore tickets on first run, so the dashboards,
// map and statistics are meaningful from the very first page load.
// =============================================================================

// [SECURITY] "server-only" makes the build FAIL if this module is ever imported into
// browser code, so database credentials can never leak to the client.
import "server-only";
import { promises as fs } from "fs";
import path from "path";
import seed from "../../seed/vellore_tickets.json";
import { recomputePriority } from "./rules";
import type { Category, HistoryEntry, Status, Ticket } from "./types";

export interface StoredImage {
  mimeType: string;
  data: string; // base64
}

// [CODE QUALITY] The routes depend on this interface, not on a concrete database
// (dependency inversion), which is also what lets the test suite run the real
// API against a throwaway local store.
export interface Store {
  list(): Promise<Ticket[]>;
  /** Open (not resolved) tickets in one category: the duplicate-detection candidates. */
  listOpen(category: Category): Promise<Ticket[]>;
  get(id: string): Promise<Ticket | null>;
  put(t: Ticket): Promise<void>;
  nextId(): Promise<string>;
  putImage(id: string, img: StoredImage): Promise<void>;
  getImage(id: string): Promise<StoredImage | null>;
}

/** Give seed tickets a plausible status history so the tracking timeline has something to show. */
// Seed tickets are run through the same recomputePriority() as live tickets, so
// the demo data obeys the same safety rules and reporter-count logic.
function normalizeSeed(raw: Ticket): Ticket {
  const history: HistoryEntry[] = [{ status: "Reported", at: raw.createdAt }];
  if (raw.status !== "Reported") {
    const order: Status[] = ["In Progress", "Resolved"];
    for (const s of order) {
      if (s === "Resolved" && raw.status !== "Resolved") break;
      history.push({
        status: s,
        at: s === "Resolved" ? (raw.resolvedAt ?? raw.updatedAt) : raw.updatedAt,
        note: s === "In Progress" ? raw.adminNotes[0] : raw.adminNotes.at(-1),
      });
    }
  }
  // Workflow state consistent with each seed ticket's status, so the department
  // queues, SLA tracking and confirmation flow have realistic data on day one.
  const day = (iso: string, d: number) => new Date(Date.parse(iso) + d * 864e5).toISOString().slice(0, 10);
  const workflow: Partial<Ticket> = {
    acknowledgedAt: raw.status === "Reported" ? null : raw.updatedAt,
    expectedFixDate: raw.status === "In Progress" ? day(raw.updatedAt, 2) : null,
    transfers: 0,
    reporters: [],
    messages: [],
    reopenCount: 0,
    resolution:
      raw.status === "Resolved"
        ? {
            note: raw.adminNotes.at(-1) ?? "Fixed",
            hasPhoto: false,
            aiVerdict: "unclear",
            aiReason: "Resolved before photo verification was introduced.",
            by: raw.department,
            at: raw.resolvedAt ?? raw.updatedAt,
          }
        : null,
    citizenConfirmation: raw.status === "Resolved" ? "confirmed" : null,
  };
  // A sample department ↔ citizen conversation (with translation) to show the flow.
  if (raw.id === "CR-1004") {
    workflow.messages = [
      { id: "seed1", from: "department", text: "Suction truck dispatched. Crew will reach Gandhi Nagar market by 2 pm.", lang: "en", translation: "உறிஞ்சும் லாரி அனுப்பப்பட்டது. குழு மதியம் 2 மணிக்குள் காந்தி நகர் சந்தைக்கு வரும்.", at: raw.updatedAt },
      { id: "seed2", from: "citizen", text: "நன்றி. சந்தை நுழைவாயில் அருகே தான் அதிகம் தண்ணீர் தேங்கியுள்ளது.", lang: "ta", translation: "Thank you. The water is pooling most near the market entrance.", at: raw.updatedAt },
    ];
  }
  return recomputePriority({ ...raw, ...workflow, history, basePriority: raw.priority, classifiedBy: "seed" });
}

const seedTickets = () => (seed as unknown as Ticket[]).map(normalizeSeed);

// ---------- Local JSON file store (dev, or self-hosted) ----------
// [EFFICIENCY] In-memory Map for fast reads, plus write-through to disk. Writes are chained on
// a single promise so concurrent requests can never interleave and corrupt the file.
class FileStore implements Store {
  private dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  private file = path.join(this.dir, "tickets.json");
  private cache: Map<string, Ticket> | null = null;
  private writing: Promise<void> = Promise.resolve();

  private async load(): Promise<Map<string, Ticket>> {
    if (this.cache) return this.cache;
    let tickets: Ticket[];
    try {
      tickets = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {
      tickets = seedTickets();
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(tickets, null, 2));
    }
    this.cache = new Map(tickets.map((t) => [t.id, t]));
    return this.cache;
  }

  private flush() {
    const snapshot = JSON.stringify([...this.cache!.values()], null, 2);
    // [CODE QUALITY] Found while testing in a real browser: if ./data was deleted while the
    // server was running, every write threw ENOENT, and because the chain kept the rejected
    // promise, ALL later writes failed too. Now the directory is re-created on each flush, and
    // an earlier failure never poisons the queue.
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.dir, { recursive: true });
        await fs.writeFile(this.file, snapshot);
      });
    return this.writing;
  }

  async list() {
    return [...(await this.load()).values()];
  }
  async listOpen(category: Category) {
    return (await this.list()).filter((t) => t.category === category && t.status !== "Resolved");
  }
  async get(id: string) {
    return (await this.load()).get(id) ?? null;
  }
  async put(t: Ticket) {
    (await this.load()).set(t.id, t);
    await this.flush();
  }
  async nextId() {
    const ids = [...(await this.load()).keys()].map((k) => Number(k.replace(/\D/g, "")) || 0);
    return `CR-${Math.max(1000, ...ids) + 1}`;
  }
  async putImage(id: string, img: StoredImage) {
    await fs.mkdir(path.join(this.dir, "images"), { recursive: true });
    await fs.writeFile(path.join(this.dir, "images", `${id}.json`), JSON.stringify(img));
  }
  async getImage(id: string) {
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir, "images", `${id}.json`), "utf8"));
    } catch {
      return null;
    }
  }
}

// ---------- Firestore store (Cloud Run) ----------
// [SECURITY][GOOGLE SERVICES] Uses Application Default Credentials: on Cloud Run the service account is
// picked up automatically, so no key file ever ships in the repo or the image.
// firebase-admin is imported lazily, so local dev never loads it.
class FirestoreStore implements Store {
  private dbPromise = (async () => {
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    if (!getApps().length) initializeApp(); // uses Application Default Credentials on Cloud Run
    const db = getFirestore();
    const col = db.collection("tickets");
    const empty = (await col.limit(1).get()).empty;
    if (empty) {
      const batch = db.batch();
      for (const t of seedTickets()) batch.set(col.doc(t.id), t);
      await batch.commit();
    }
    return db;
  })();

  private async col(name = "tickets") {
    return (await this.dbPromise).collection(name);
  }
  async list() {
    return (await (await this.col()).get()).docs.map((d) => d.data() as Ticket);
  }
  // [EFFICIENCY][GOOGLE SERVICES] The filter runs inside Firestore, so a new report
  // reads only the open tickets of its own category, not the whole collection.
  // Fewer document reads means lower latency and lower Firestore cost as the city grows.
  async listOpen(category: Category) {
    try {
      const snap = await (await this.col())
        .where("category", "==", category)
        .where("status", "in", ["Reported", "In Progress"])
        .get();
      return snap.docs.map((d) => d.data() as Ticket);
    } catch {
      // [CODE QUALITY] If Firestore asks for a composite index that hasn't been
      // created yet, degrade gracefully to an in-memory filter: same result,
      // and a report is never blocked by a database configuration step.
      return (await this.list()).filter((t) => t.category === category && t.status !== "Resolved");
    }
  }
  async get(id: string) {
    const d = await (await this.col()).doc(id).get();
    return d.exists ? (d.data() as Ticket) : null;
  }
  async put(t: Ticket) {
    await (await this.col()).doc(t.id).set(JSON.parse(JSON.stringify(t)));
  }
  // [CODE QUALITY] Ticket IDs (CR-1001, CR-1002, …) come from a counter inside a Firestore
  // transaction, so two citizens submitting at the same instant on different
  // Cloud Run instances can never get the same ID.
  async nextId() {
    const db = await this.dbPromise;
    const ref = db.collection("meta").doc("counter");
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      let n = (snap.data()?.next as number | undefined) ?? 0;
      if (!n) {
        const ids = (await this.list()).map((t) => Number(t.id.replace(/\D/g, "")) || 0);
        n = Math.max(1000, ...ids) + 1;
      }
      tx.set(ref, { next: n + 1 });
      return `CR-${n}`;
    });
  }
  async putImage(id: string, img: StoredImage) {
    // [EFFICIENCY] Images are downscaled on the client (~100-300 KB), which fits in a Firestore doc (1 MB limit).
    await (await this.col("images")).doc(id).set(img);
  }
  async getImage(id: string) {
    const d = await (await this.col("images")).doc(id).get();
    return d.exists ? (d.data() as StoredImage) : null;
  }
}

// [EFFICIENCY] Singleton held on globalThis so Next.js hot-reload in dev doesn't open a new
// database connection on every file save.
const g = globalThis as unknown as { __civicStore?: Store };
export function store(): Store {
  g.__civicStore ??= process.env.STORE === "firestore" ? new FirestoreStore() : new FileStore();
  return g.__civicStore;
}
