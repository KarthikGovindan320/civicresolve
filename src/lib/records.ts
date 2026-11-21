// =============================================================================
// Stored-record schemas: what the database is allowed to hand back
// -----------------------------------------------------------------------------
// Data read from Firestore or the local JSON file is treated like any other
// input crossing a trust boundary: it is parsed, not cast. A record that does
// not match the domain model (a hand-edited file, a half-written document, data
// from an older version) is rejected at the store instead of failing somewhere
// deep in a page render. Every enum comes from the same constant array as the
// domain type in types.ts, and each schema is checked with
// `satisfies z.ZodType<…>`: the compiler rejects a schema whose output is not
// assignable to its type (a missing required field, a wrong field type). It
// cannot notice a new optional field the schema leaves out, so such a field
// must be added here too.
// =============================================================================
import { z } from "zod";
import {
  AI_VERDICTS,
  CATEGORIES,
  CITIZEN_CONFIRMATIONS,
  CLASSIFIED_BY,
  DEPARTMENTS,
  MESSAGE_AUTHORS,
  PRIORITIES,
  STATUSES,
  VERIFICATIONS,
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
  from: z.enum(MESSAGE_AUTHORS),
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
  aiVerdict: z.enum(AI_VERDICTS),
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
  classifiedBy: z.enum(CLASSIFIED_BY).optional(),
  acknowledgedAt: z.string().nullish(),
  expectedFixDate: z.string().nullish(),
  transfers: z.number().int().min(0).optional(),
  messages: z.array(MessageSchema).optional(),
  reporters: z.array(ReporterSchema).optional(),
  resolution: ResolutionSchema.nullish(),
  citizenConfirmation: z.enum(CITIZEN_CONFIRMATIONS).nullish(),
  reopenCount: z.number().int().min(0).optional(),
  verification: z.enum(VERIFICATIONS).optional(),
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
