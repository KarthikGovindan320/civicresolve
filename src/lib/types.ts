// =============================================================================
// DOMAIN MODEL: the single source of truth shared by the AI layer, the API,
// the database and every screen.
// -----------------------------------------------------------------------------
// The same constant arrays drive (1) the JSON-schema enums sent to Gemini,
// (2) zod runtime validation of Gemini's answer, (3) API input validation and
// (4) the dropdowns in the UI. Adding a category here updates all four at once,
// so the AI can never return a label the rest of the system doesn't understand.
// =============================================================================

// "Category": the civic issue types named in the problem statement
// (potholes, garbage, streetlights, water leakage, poor roads) plus sewage and
// electrical hazards, the two most dangerous real-world categories.
export const CATEGORIES = [
  "Pothole",
  "Road Damage",
  "Garbage",
  "Streetlight",
  "Water Leakage",
  "Sewage/Drainage",
  "Electrical Hazard",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];

// Priority Detection: four ordered levels. The order matters:
// rules.ts bumps priority by index, so the array runs lowest → highest.
export const PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

// Issue tracking: exactly the three statuses named in the brief
// ("Reported, In Progress, and Resolved"), in lifecycle order.
export const STATUSES = ["Reported", "In Progress", "Resolved"] as const;
export type Status = (typeof STATUSES)[number];

// Department Recommendation: realistic departments of an Indian
// municipal corporation (TANGEDCO is Tamil Nadu's electricity utility).
export const DEPARTMENTS = [
  "Public Works (Roads)",
  "Sanitation",
  "Electricity Board (TANGEDCO)",
  "Water Supply",
  "Drainage & Sewerage",
  "General Administration",
] as const;
export type Department = (typeof DEPARTMENTS)[number];

// Deterministic category → department routing table. Used when AI is
// unavailable and when an admin re-categorises a ticket, so routing is never
// left blank. `Record<Category, Department>` makes TypeScript refuse to compile
// if a category is ever added without a department.
export const CATEGORY_DEPARTMENT: Record<Category, Department> = {
  Pothole: "Public Works (Roads)",
  "Road Damage": "Public Works (Roads)",
  Garbage: "Sanitation",
  Streetlight: "Electricity Board (TANGEDCO)",
  "Water Leakage": "Water Supply",
  "Sewage/Drainage": "Drainage & Sewerage",
  "Electrical Hazard": "Electricity Board (TANGEDCO)",
  Other: "General Administration",
};

export interface Location {
  lat: number;
  lng: number;
  address: string;
}

// Service-level targets: how fast each priority
// must be resolved. Overdue tickets are escalated to the city admin and count
// against the department's on-time rate. That gives "resolution" a deadline,
// not just a status.
export const SLA_HOURS: Record<Priority, number> = {
  Critical: 24,
  High: 72,
  Medium: 7 * 24,
  Low: 14 * 24,
};

// Days after a fix is reported before an unanswered ticket closes automatically.
export const AUTO_CLOSE_DAYS = 3;

// Who can act on a ticket. Citizens are anonymous and prove ownership with a
// private link token; staff sign in either as a department or as the city admin.
export type Role = { role: "admin" } | { role: "department"; department: Department };

// Two-way conversation between the
// department and the citizen. Each message keeps the author's original text,
// and Gemini adds a translation so a Tamil-speaking citizen and an
// English-writing official can understand each other.
export interface Message {
  id: string;
  from: "citizen" | "department" | "admin" | "system";
  text: string;
  lang: string; // ISO 639-1 language of `text`
  translation?: string | null; // English for citizen messages; citizen's language for staff messages
  at: string;
}

// A reporter's private access. The link token itself is NOT stored:
// it is HMAC-SHA256(server secret, salt), so the database alone (e.g. a leaked
// backup) can't produce a working link, while the server can still put the link
// in emails. The email (optional) is used only by the server to send updates.
// It is never returned by any API, so department staff never see who reported
// an issue.
export interface Reporter {
  salt: string;
  email: string | null;
  /** OTP-verified mobile number (E.164). PRIVATE: never returned by any API, shown to staff, or logged.
   *  Kept only so that a bogus or abusive report can be traced if it is ever investigated. */
  phone?: string | null;
  at: string;
}

// Proof of resolution: the department's "after"
// photo, checked by Gemini against the citizen's original report.
export interface Resolution {
  note: string;
  hasPhoto: boolean;
  aiVerdict: "fixed" | "not_fixed" | "unclear";
  aiReason: string;
  by: string; // department name
  at: string;
}

// Every status change and admin note is appended here. This powers the public
// timeline on the ticket page: transparency about what happened and when.
export interface HistoryEntry {
  status: Status;
  at: string;
  note?: string;
}

// A citizen complaint ("ticket"). Field groups map to the brief:
//   title / description / location / hasImage → Citizen Issue Reporting
//   category                                  → AI-Powered Classification
//   priority / priorityReason                 → Priority Detection (with explanation)
//   department                                → Department Recommendation
//   status / history / resolvedAt             → Tracking & Resolution
// and to our additions:
//   originalLanguage / englishSummary / transcript → multilingual voice reporting
//   reporterCount                                  → duplicate merging & public impact
//   classifiedBy                                   → AI audit trail for admins
export interface Ticket {
  id: string;
  title: string;
  description: string;
  // Multilingual support: the citizen's own words are kept untouched, and an
  // English summary is stored next to them for officials.
  originalLanguage: string;
  englishSummary: string;
  transcript?: string | null;
  category: Category;
  // `priority` is what everyone sees; `basePriority` is the AI's original call.
  // Keeping both lets rules.ts recompute safely as more citizens report the
  // same issue, without compounding bumps.
  priority: Priority;
  /** Priority before safety rules and reporter-count bumps. */
  basePriority?: Priority;
  priorityReason: string;
  department: Department;
  status: Status;
  location: Location;
  // How many citizens reported this same problem (duplicates are merged, not
  // discarded). Used as a public-impact signal for prioritisation.
  reporterCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  adminNotes: string[];
  hasImage: boolean;
  history?: HistoryEntry[];
  /** "gemini" when classified by AI, "fallback" when the rule-based path was used. */
  classifiedBy?: "gemini" | "fallback" | "seed";

  // ---- Department workflow (beyond the brief) ----
  /** When the responsible department accepted the ticket. */
  acknowledgedAt?: string | null;
  /** Date the department committed to fixing it by (YYYY-MM-DD). */
  expectedFixDate?: string | null;
  /** Number of times the ticket was handed to another department. */
  transfers?: number;
  /** Department ↔ citizen conversation (private: never in the public list). */
  messages?: Message[];
  /** Private: everyone who reported this issue (hashed link tokens, optional emails). */
  reporters?: Reporter[];
  /** Proof of fix submitted by the department. */
  resolution?: Resolution | null;
  /** Citizen's verdict on the fix. "pending" until they answer or it auto-closes. */
  citizenConfirmation?: "pending" | "confirmed" | "reopened" | "auto-closed" | null;
  /** How many times citizens reopened the ticket after a claimed fix. */
  reopenCount?: number;
  /** How the reporter was verified. "phone" = OTP-verified (normal flow). "unverified" = submitted
   *  without a phone number: held in a separate review bucket for the city admin. "approved" /
   *  "rejected" = the admin's review decision. Missing (seed / legacy data) counts as verified. */
  verification?: Verification;
  /** True when the citizen attached a new photo while reopening (stored as `<id>-reopen`). */
  hasReopenPhoto?: boolean;
}

// What each audience is allowed to see. The API never returns a raw
// Ticket: `reporters` (tokens, emails) is always removed; `messages` only go to
// the ticket's own citizen and to staff.
export type PublicTicket = Omit<Ticket, "reporters" | "messages"> & {
  messageCount: number;
  slaDueAt: string;
  overdue: boolean;
};
export type PrivateTicket = PublicTicket & { messages: Message[] };

// Shape of Gemini's structured answer (validated with zod in gemini.ts).
export interface Classification {
  title: string;
  category: Category;
  priority: Priority;
  priorityReason: string;
  department: Department;
  englishSummary: string;
  detectedLanguage: string;
  transcript: string | null;
}

// Promised fix dates are stored as plain "YYYY-MM-DD" but shown as "24 Nov 2026",
// the same style as every other date in the app (found by clicking through the app in a real
// browser: raw ISO dates read oddly, especially to screen-reader users).
/** Maximum lengths of citizen and staff input. Shared by the API (server-side truncation) and the
 *  form fields (maxLength), so the two can never disagree. */
export const LIMITS = {
  title: 120,
  description: 2000,
  address: 200,
  email: 254,
  staffNote: 500,
  message: 1000,
  citizenNote: 1000,
  search: 120,
} as const;

export const fmtDay = (isoDay: string) =>
  new Date(`${isoDay}T00:00:00Z`).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "UTC" });

// Two buckets for reports.
// Phone-verified reports flow straight to the department. Reports sent WITHOUT phone verification
// are not thrown away (a genuine citizen may have no phone or not want to share it), but they are
// HELD: invisible to the public and to departments until the city admin approves them.
export type Verification = "phone" | "unverified" | "approved" | "rejected";
export const isPendingReview = (t: { verification?: Verification }) => t.verification === "unverified";
export const isHeld = (t: { verification?: Verification }) =>
  t.verification === "unverified" || t.verification === "rejected";
