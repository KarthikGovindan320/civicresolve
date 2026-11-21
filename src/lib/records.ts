// =============================================================================
// Stored-record schemas: what the database is allowed to hand back
// -----------------------------------------------------------------------------
// Data read from Firestore or the local JSON file is treated like any other
// input crossing a trust boundary: it is parsed, not cast. A record that does
// not match the domain model (a hand-edited file, a half-written document, data
// from an older version) is rejected at the store instead of failing somewhere
// deep in a page render. Each schema is checked against the TypeScript type it
// produces (`satisfies z.ZodType<…>`), so the two can never drift apart.
// =============================================================================
import { z } from "zod";
import { VERIFICATION_VERDICTS } from "./ai/prompts";
import {
  CATEGORIES,
  DEPARTMENTS,
  PRIORITIES,
  STATUSES,
  type HistoryEntry,
  type Message,
  type Reporter,
  type Resolution,
  type Ticket,
} from "./types";

const HistoryEntrySchema = z.object({
  status: z.enum(STATUSES),
  at: z.string(),
  note: z.string().optional(),
}) satisfies z.ZodType<HistoryEntry>;

const MessageSchema = z.object({
  id: z.string(),
  from: z.enum(["citizen", "department", "admin", "system"]),
  text: z.string(),
  lang: z.string(),
  translation: z.string().nullish(),
  at: z.string(),
}) satisfies z.ZodType<Message>;

const ReporterSchema = z.object({
  salt: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullish(),
  at: z.string(),
}) satisfies z.ZodType<Reporter>;

const ResolutionSchema = z.object({
  note: z.string(),
  hasPhoto: z.boolean(),
  aiVerdict: z.enum(VERIFICATION_VERDICTS),
  aiReason: z.string(),
  by: z.string(),
  at: z.string(),
}) satisfies z.ZodType<Resolution>;

/** A ticket as stored. Optional fields are the ones older records may lack. */
export const TicketRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  originalLanguage: z.string(),
  englishSummary: z.string(),
  transcript: z.string().nullish(),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  basePriority: z.enum(PRIORITIES).optional(),
  priorityReason: z.string(),
  department: z.enum(DEPARTMENTS),
  status: z.enum(STATUSES),
  location: z.object({ lat: z.number(), lng: z.number(), address: z.string() }),
  reporterCount: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  adminNotes: z.array(z.string()),
  hasImage: z.boolean(),
  history: z.array(HistoryEntrySchema).optional(),
  classifiedBy: z.enum(["gemini", "fallback", "seed"]).optional(),
  acknowledgedAt: z.string().nullish(),
  expectedFixDate: z.string().nullish(),
  transfers: z.number().int().min(0).optional(),
  messages: z.array(MessageSchema).optional(),
  reporters: z.array(ReporterSchema).optional(),
  resolution: ResolutionSchema.nullish(),
  citizenConfirmation: z.enum(["pending", "confirmed", "reopened", "auto-closed"]).nullish(),
  reopenCount: z.number().int().min(0).optional(),
  verification: z.enum(["phone", "unverified", "approved", "rejected"]).optional(),
  hasReopenPhoto: z.boolean().optional(),
}) satisfies z.ZodType<Ticket>;

/** A photo as kept in the image collection, apart from the ticket itself. */
export const StoredImageSchema = z.object({
  mimeType: z.string(),
  /** Base64-encoded bytes. */
  data: z.string(),
});
export type StoredImage = z.infer<typeof StoredImageSchema>;

/** The ticket in `data`, or null when it does not match the domain model. */
export function parseTicket(data: unknown): Ticket | null {
  const parsed = TicketRecordSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** The photo in `data`, or null when it is not a stored image. */
export function parseStoredImage(data: unknown): StoredImage | null {
  const parsed = StoredImageSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
