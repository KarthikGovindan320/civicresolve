// =============================================================================
// Request-body schemas for the staff ticket actions (PATCH /api/tickets/[id])
// -----------------------------------------------------------------------------
// The body is a discriminated union on `action`. Every field is whitelisted
// against the domain enums in types.ts, so a client cannot write arbitrary
// fields or values.
//
// The field schemas are deliberately forgiving: a missing or malformed value
// parses to "not provided" (null / undefined / "") instead of failing the whole
// body. The action functions in services/ticket-actions.ts then decide which
// plain-language error to return, after the permission checks, so a caller
// without permission is never told about the shape of a body they may not send.
// The only body this module rejects outright is one with an unknown `action`.
// =============================================================================
import { z } from "zod";
import { CATEGORIES, DEPARTMENTS, LIMITS, PRIORITIES, STATUSES } from "./types";

/** Calendar date as stored for promised fix dates: YYYY-MM-DD. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Older clients omit `action` when sending admin overrides, so that is the default. */
const DEFAULT_ACTION = "update";

/** A staff note: trimmed and capped; anything that isn't a string counts as no note. */
const staffNote = z
  .string()
  .transform((text) => text.trim().slice(0, LIMITS.staffNote))
  .catch("");

const ReviewAction = z.object({
  action: z.literal("review"),
  decision: z.enum(["approve", "reject"]).nullable().catch(null),
  note: staffNote,
});

const AcknowledgeAction = z.object({
  action: z.literal("acknowledge"),
  expectedFixDate: z.string().regex(ISO_DATE_PATTERN).nullable().catch(null),
  note: staffNote,
});

const TransferAction = z.object({
  action: z.literal("transfer"),
  department: z.enum(DEPARTMENTS).nullable().catch(null),
  note: staffNote,
});

const NoteAction = z.object({
  action: z.literal("note"),
  note: staffNote,
});

const UpdateAction = z.object({
  action: z.literal("update"),
  status: z.enum(STATUSES).optional().catch(undefined),
  category: z.enum(CATEGORIES).optional().catch(undefined),
  priority: z.enum(PRIORITIES).optional().catch(undefined),
  // Naming a department pins it; otherwise a category change re-routes automatically.
  department: z.enum(DEPARTMENTS).optional().catch(undefined),
  note: staffNote,
});

/** Body of PATCH /api/tickets/[id], discriminated on `action`. */
export const TicketActionSchema = z.discriminatedUnion("action", [
  ReviewAction,
  AcknowledgeAction,
  TransferAction,
  NoteAction,
  UpdateAction,
]);

export type TicketAction = z.infer<typeof TicketActionSchema>;
export type TicketActionName = TicketAction["action"];
export type ReviewInput = z.infer<typeof ReviewAction>;
export type AcknowledgeInput = z.infer<typeof AcknowledgeAction>;
export type TransferInput = z.infer<typeof TransferAction>;
export type NoteInput = z.infer<typeof NoteAction>;
export type UpdateInput = z.infer<typeof UpdateAction>;

/** Parse a PATCH body into a typed action, or null when `action` names nothing we support. */
export function parseTicketAction(body: Record<string, unknown>): TicketAction | null {
  const action = typeof body.action === "string" ? body.action : DEFAULT_ACTION;
  const parsed = TicketActionSchema.safeParse({ ...body, action });
  return parsed.success ? parsed.data : null;
}
