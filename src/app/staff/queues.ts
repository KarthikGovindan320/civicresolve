import { PRIORITIES, isHeld, isPendingReview } from "@/lib/types";
import type { StaffTicket } from "./types";

/**
 * The work queues shown as tabs on the staff dashboard. Tickets move through
 * them by stage (to accept, in progress, awaiting citizen, closed), with
 * Overdue cutting across stages. Escalations and Unverified are for the city
 * admin only.
 */
export const QUEUES = {
  todo: { label: "To accept", match: (ticket: StaffTicket) => ticket.status === "Reported" },
  doing: { label: "In progress", match: (ticket: StaffTicket) => ticket.status === "In Progress" },
  awaiting: {
    label: "Awaiting citizen",
    match: (ticket: StaffTicket) => ticket.status === "Resolved" && ticket.citizenConfirmation === "pending",
  },
  closed: {
    label: "Closed",
    match: (ticket: StaffTicket) => ticket.status === "Resolved" && ticket.citizenConfirmation !== "pending",
  },
  overdue: { label: "Overdue", match: (ticket: StaffTicket) => ticket.overdue },
  // Needs the admin's attention: overdue, reopened by the citizen, or a claimed fix the AI doubts.
  escalations: {
    label: "Escalations",
    match: (ticket: StaffTicket) =>
      ticket.overdue ||
      (ticket.status !== "Resolved" && (ticket.reopenCount ?? 0) > 0) ||
      (ticket.status === "Resolved" &&
        ticket.resolution?.aiVerdict === "not_fixed" &&
        ticket.citizenConfirmation === "pending"),
  },
  all: { label: "All", match: () => true },
  // Reports sent without phone verification wait here for the admin to screen them.
  review: { label: "Unverified", match: (ticket: StaffTicket) => isPendingReview(ticket) },
} as const;

export type QueueKey = keyof typeof QUEUES;

/** Queues that only the city admin sees. */
const ADMIN_ONLY_QUEUES: readonly QueueKey[] = ["escalations", "review"];

/** The queue tabs available to a role, in display order. */
export const queuesFor = (isAdmin: boolean) =>
  (Object.keys(QUEUES) as QueueKey[]).filter((queue) => isAdmin || !ADMIN_ONLY_QUEUES.includes(queue));

/**
 * Whether a ticket belongs in a queue. Held reports appear only in the review
 * queue, never in the working queues or the statistics.
 */
export const inQueue = (queue: QueueKey, ticket: StaffTicket) =>
  queue === "review" ? isPendingReview(ticket) : !isHeld(ticket) && QUEUES[queue].match(ticket);

const priorityRank = (ticket: StaffTicket) => PRIORITIES.indexOf(ticket.priority);

/** Sort comparator for a triage queue: overdue first, then priority, then number of reporters, then oldest. */
export const byTriageOrder = (first: StaffTicket, second: StaffTicket) =>
  Number(second.overdue) - Number(first.overdue) ||
  priorityRank(second) - priorityRank(first) ||
  second.reporterCount - first.reporterCount ||
  first.createdAt.localeCompare(second.createdAt);
