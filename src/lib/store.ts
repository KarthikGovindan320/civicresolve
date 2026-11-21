// =============================================================================
// Persistence layer: one interface, two interchangeable backends
// -----------------------------------------------------------------------------
//   • FirestoreStore: production on Google Cloud Run (serverless, scales to zero,
//     survives redeploys). Enabled with STORE=firestore.
//   • FileStore: zero-setup local development: a JSON file, no cloud account needed.
// API routes only talk to the `Store` interface, so switching backends is a
// single environment variable and needs no code changes. Both backends seed
// themselves with realistic Vellore tickets on first run, so the dashboards,
// map and statistics are meaningful from the very first page load.
// =============================================================================

// "server-only" makes the build fail if this module is ever imported into
// browser code, so database credentials can never leak to the client.
import "server-only";
import { promises as fs } from "fs";
import path from "path";
import seed from "../../seed/vellore_tickets.json";
import { log } from "./log";
import { parseStoredImage, parseTicket, type StoredImage } from "./records";
import { recomputePriority } from "./rules";
import type { Category, HistoryEntry, Message, Ticket } from "./types";

export type { StoredImage } from "./records";

/** Builds the change to a ticket from its latest stored version; null leaves it untouched. */
export type TicketChange = (current: Ticket) => Ticket | null;

/**
 * What the routes depend on, instead of a concrete database (dependency
 * inversion). It is also what lets the test suite run the real API against a
 * throwaway local store.
 *
 * Changes to an existing ticket go through `update`, which reads the latest
 * version and writes the result atomically (a Firestore transaction, or a
 * single-writer queue locally). Two staff actions, or a staff action and a
 * duplicate report, arriving at the same moment are therefore applied one
 * after the other instead of the later one silently overwriting the earlier.
 */
export interface Store {
  list(): Promise<Ticket[]>;
  /** Open (not resolved) tickets in one category: the duplicate-detection candidates. */
  listOpen(category: Category): Promise<Ticket[]>;
  get(id: string): Promise<Ticket | null>;
  /** Allocate the next ticket id and save the ticket built for it, as one atomic step. */
  create(build: (id: string) => Ticket): Promise<Ticket>;
  /** Apply `change` to the latest stored ticket atomically. Resolves to the saved ticket, or null if nothing was saved. */
  update(id: string, change: TicketChange): Promise<Ticket | null>;
  /** Replace a ticket outright (seeding and tests). Prefer `update` for changes. */
  put(ticket: Ticket): Promise<void>;
  putImage(id: string, image: StoredImage): Promise<void>;
  getImage(id: string): Promise<StoredImage | null>;
}

const TICKET_ID_PREFIX = "CR-";
/** The first ticket ever issued is CR-1001. */
const TICKET_ID_FLOOR = 1000;
const DAY_MS = 864e5;
/** Seed tickets that are in progress promise a fix this many days after they were accepted. */
const SEED_FIX_DAYS = 2;
/** The seed ticket that carries a sample translated conversation. */
const SEED_CONVERSATION_TICKET_ID = "CR-1004";

const TICKETS_COLLECTION = "tickets";
const IMAGES_COLLECTION = "images";
const META_COLLECTION = "meta";
const COUNTER_DOC = "counter";
const OPEN_STATUSES: Ticket["status"][] = ["Reported", "In Progress"];

/** The number inside a ticket id ("CR-1042" → 1042), or 0 if there is none. */
const ticketNumber = (id: string) => Number(id.replace(/\D/g, "")) || 0;

/** The id after the highest one in use. */
function nextTicketNumber(ids: Iterable<string>): number {
  return Math.max(TICKET_ID_FLOOR, ...[...ids].map(ticketNumber)) + 1;
}

const isOpenInCategory = (ticket: Ticket, category: Category) =>
  ticket.category === category && ticket.status !== "Resolved";

/** The calendar day (YYYY-MM-DD) `days` after an ISO timestamp. */
const dayAfter = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY_MS).toISOString().slice(0, 10);

/** A seed ticket's status history: Reported, then In Progress and Resolved as far as it got. */
function seedHistory(raw: Ticket): HistoryEntry[] {
  const history: HistoryEntry[] = [{ status: "Reported", at: raw.createdAt }];
  if (raw.status === "Reported") return history;
  history.push({ status: "In Progress", at: raw.updatedAt, note: raw.adminNotes[0] });
  if (raw.status === "Resolved")
    history.push({ status: "Resolved", at: raw.resolvedAt ?? raw.updatedAt, note: raw.adminNotes.at(-1) });
  return history;
}

/** Resolution record for seed tickets that are already fixed (they predate photo verification). */
function seedResolution(raw: Ticket): Ticket["resolution"] {
  if (raw.status !== "Resolved") return null;
  return {
    note: raw.adminNotes.at(-1) ?? "Fixed",
    hasPhoto: false,
    aiVerdict: "unclear",
    aiReason: "Resolved before photo verification was introduced.",
    by: raw.department,
    at: raw.resolvedAt ?? raw.updatedAt,
  };
}

/** One seed ticket carries a sample department ↔ citizen conversation (with translation) to show the flow. */
function seedMessages(raw: Ticket): Message[] {
  if (raw.id !== SEED_CONVERSATION_TICKET_ID) return [];
  return [
    {
      id: "seed1",
      from: "department",
      text: "Suction truck dispatched. Crew will reach Gandhi Nagar market by 2 pm.",
      lang: "en",
      translation: "உறிஞ்சும் லாரி அனுப்பப்பட்டது. குழு மதியம் 2 மணிக்குள் காந்தி நகர் சந்தைக்கு வரும்.",
      at: raw.updatedAt,
    },
    {
      id: "seed2",
      from: "citizen",
      text: "நன்றி. சந்தை நுழைவாயில் அருகே தான் அதிகம் தண்ணீர் தேங்கியுள்ளது.",
      lang: "ta",
      translation: "Thank you. The water is pooling most near the market entrance.",
      at: raw.updatedAt,
    },
  ];
}

/**
 * Give a seed ticket a plausible history and workflow state consistent with its status, so the
 * tracking timeline, department queues and SLA figures have realistic data on day one. Seed tickets
 * go through the same recomputePriority() as live tickets, so they obey the same safety rules.
 */
function normalizeSeed(raw: Ticket): Ticket {
  return recomputePriority({
    ...raw,
    acknowledgedAt: raw.status === "Reported" ? null : raw.updatedAt,
    expectedFixDate: raw.status === "In Progress" ? dayAfter(raw.updatedAt, SEED_FIX_DAYS) : null,
    transfers: 0,
    reporters: [],
    messages: seedMessages(raw),
    reopenCount: 0,
    resolution: seedResolution(raw),
    citizenConfirmation: raw.status === "Resolved" ? "confirmed" : null,
    history: seedHistory(raw),
    basePriority: raw.priority,
    classifiedBy: "seed",
  });
}

/** The bundled demo tickets, validated like any stored record and brought up to the current model. */
function seedTickets(): Ticket[] {
  return seed.flatMap((raw) => {
    const ticket = parseTicket(raw);
    if (!ticket) throw new Error(`Seed ticket ${raw.id} does not match the ticket model.`);
    return [normalizeSeed(ticket)];
  });
}

/** Parse every stored record, skipping (and logging) any that no longer match the model. */
function validTickets(records: unknown[]): Ticket[] {
  return records.flatMap((record) => {
    const ticket = parseTicket(record);
    if (!ticket) log.warn("invalid_ticket_record_skipped");
    return ticket ? [ticket] : [];
  });
}

const isMissingFile = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

// ---------- Local JSON file store (dev, or self-hosted) ----------
// An in-memory Map for fast reads, plus write-through to disk. Every write runs
// on one queue, so concurrent requests never interleave: an id is never handed
// out twice and a read-modify-write never loses another request's change.
class FileStore implements Store {
  private dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  private file = path.join(this.dir, "tickets.json");
  private imageDir = path.join(this.dir, "images");
  private cache: Promise<Map<string, Ticket>> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  /** Load once. Only a missing file is seeded: a corrupt or unreadable one is an error, never overwritten. */
  private load(): Promise<Map<string, Ticket>> {
    this.cache ??= this.readOrSeed().then((tickets) => new Map(tickets.map((ticket) => [ticket.id, ticket])));
    return this.cache;
  }

  private async readOrSeed(): Promise<Ticket[]> {
    try {
      const records: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (!Array.isArray(records)) throw new Error(`${this.file} does not contain a list of tickets.`);
      return validTickets(records);
    } catch (error) {
      if (!isMissingFile(error)) {
        this.cache = null; // let a later request retry once the file is fixed
        throw error;
      }
      const tickets = seedTickets();
      await this.write(tickets);
      return tickets;
    }
  }

  private async write(tickets: Iterable<Ticket>) {
    // The directory is re-created on each write, so deleting ./data while the server runs is harmless.
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file, JSON.stringify([...tickets], null, 2));
  }

  /** Run `task` after every earlier write has finished; a failed write never blocks later ones. */
  private exclusive<T>(task: (tickets: Map<string, Ticket>) => Promise<T>): Promise<T> {
    const run = this.queue.catch(() => undefined).then(async () => task(await this.load()));
    this.queue = run;
    return run;
  }

  async list() {
    return [...(await this.load()).values()];
  }
  async listOpen(category: Category) {
    return (await this.list()).filter((ticket) => isOpenInCategory(ticket, category));
  }
  async get(id: string) {
    return (await this.load()).get(id) ?? null;
  }
  create(build: (id: string) => Ticket) {
    return this.exclusive(async (tickets) => {
      const ticket = build(`${TICKET_ID_PREFIX}${nextTicketNumber(tickets.keys())}`);
      tickets.set(ticket.id, ticket);
      await this.write(tickets.values());
      return ticket;
    });
  }
  update(id: string, change: TicketChange) {
    return this.exclusive(async (tickets) => {
      const current = tickets.get(id);
      const changed = current ? change(current) : null;
      if (!changed) return null;
      tickets.set(id, changed);
      await this.write(tickets.values());
      return changed;
    });
  }
  put(ticket: Ticket) {
    return this.exclusive(async (tickets) => {
      tickets.set(ticket.id, ticket);
      await this.write(tickets.values());
    });
  }
  async putImage(id: string, image: StoredImage) {
    await fs.mkdir(this.imageDir, { recursive: true });
    await fs.writeFile(path.join(this.imageDir, `${id}.json`), JSON.stringify(image));
  }
  async getImage(id: string) {
    try {
      return parseStoredImage(JSON.parse(await fs.readFile(path.join(this.imageDir, `${id}.json`), "utf8")));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }
}

// ---------- Firestore store (Cloud Run) ----------
// Uses Application Default Credentials: on Cloud Run the service account is picked up
// automatically, so no key file ever ships in the repo or the container image.
// firebase-admin is imported lazily, so local dev never loads it.

/** Firestore refuses `undefined` fields; a JSON round trip drops them. */
const toFirestore = (ticket: Ticket): Record<string, unknown> => JSON.parse(JSON.stringify(ticket));

class FirestoreStore implements Store {
  private dbPromise = (async () => {
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    if (!getApps().length) initializeApp(); // uses Application Default Credentials on Cloud Run
    const db = getFirestore();
    const tickets = db.collection(TICKETS_COLLECTION);
    const isEmpty = (await tickets.limit(1).get()).empty;
    if (isEmpty) {
      const batch = db.batch();
      for (const ticket of seedTickets()) batch.set(tickets.doc(ticket.id), toFirestore(ticket));
      await batch.commit();
    }
    return db;
  })();

  private async collection(name = TICKETS_COLLECTION) {
    return (await this.dbPromise).collection(name);
  }
  async list() {
    return validTickets((await (await this.collection()).get()).docs.map((doc) => doc.data()));
  }
  // The filter runs inside Firestore, so a new report reads only the open tickets
  // of its own category, not the whole collection. Fewer document reads means
  // lower latency and lower Firestore cost as the city grows.
  async listOpen(category: Category) {
    try {
      const snapshot = await (
        await this.collection()
      )
        .where("category", "==", category)
        .where("status", "in", OPEN_STATUSES)
        .get();
      return validTickets(snapshot.docs.map((doc) => doc.data()));
    } catch {
      // If Firestore asks for a composite index that hasn't been created yet,
      // degrade gracefully to an in-memory filter: same result, and a report is
      // never blocked by a database configuration step.
      return (await this.list()).filter((ticket) => isOpenInCategory(ticket, category));
    }
  }
  async get(id: string) {
    const doc = await (await this.collection()).doc(id).get();
    return doc.exists ? parseTicket(doc.data()) : null;
  }
  // Ticket IDs (CR-1001, CR-1002, …) come from a counter updated in the same
  // transaction that writes the ticket, so two citizens submitting at the same
  // instant on different Cloud Run instances can never get the same ID.
  async create(build: (id: string) => Ticket) {
    const db = await this.dbPromise;
    const tickets = db.collection(TICKETS_COLLECTION);
    const counterRef = db.collection(META_COLLECTION).doc(COUNTER_DOC);
    return db.runTransaction(async (transaction) => {
      const counter = await transaction.get(counterRef);
      const stored: unknown = counter.data()?.next;
      // First use: start after the highest id already in the collection.
      const next =
        typeof stored === "number" && stored > 0
          ? stored
          : nextTicketNumber((await transaction.get(tickets.select())).docs.map((doc) => doc.id));
      const ticket = build(`${TICKET_ID_PREFIX}${next}`);
      transaction.set(counterRef, { next: next + 1 });
      transaction.set(tickets.doc(ticket.id), toFirestore(ticket));
      return ticket;
    });
  }
  async update(id: string, change: TicketChange) {
    const db = await this.dbPromise;
    const ref = db.collection(TICKETS_COLLECTION).doc(id);
    // Firestore retries the transaction if the ticket changed meanwhile, so `change`
    // always sees the latest version. It must therefore be a pure function.
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists ? parseTicket(snapshot.data()) : null;
      const changed = current ? change(current) : null;
      if (changed) transaction.set(ref, toFirestore(changed));
      return changed;
    });
  }
  async put(ticket: Ticket) {
    await (await this.collection()).doc(ticket.id).set(toFirestore(ticket));
  }
  async putImage(id: string, image: StoredImage) {
    // Images are downscaled on the client (~100-300 KB), which fits in a Firestore doc (1 MB limit).
    await (await this.collection(IMAGES_COLLECTION)).doc(id).set(image);
  }
  async getImage(id: string) {
    const doc = await (await this.collection(IMAGES_COLLECTION)).doc(id).get();
    return doc.exists ? parseStoredImage(doc.data()) : null;
  }
}

// The store is a singleton held on globalThis, so Next.js hot-reload in dev doesn't
// open a new database connection on every file save.
const globalWithStore: typeof globalThis & { __civicStore?: Store } = globalThis;

/** The configured persistence backend: Firestore when STORE=firestore, otherwise the local JSON file. */
export function store(): Store {
  globalWithStore.__civicStore ??= process.env.STORE === "firestore" ? new FirestoreStore() : new FileStore();
  return globalWithStore.__civicStore;
}
