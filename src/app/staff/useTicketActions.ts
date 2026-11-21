"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { type KeyedRequestOptions, failureMessages, settle, staffRequest } from "@/lib/client/api";
import type { TicketActionInput } from "@/lib/schemas";
import type { StaffTicket } from "./types";

/** Called with the server's updated ticket and a short confirmation for the status line. */
export type TicketUpdatedHandler = (ticket: StaffTicket, confirmation: string) => void;

/**
 * Sends a workflow action to the ticket; `successMessage` is announced once the
 * server accepts it. Resolves to whether it was accepted, so a form can keep
 * its input when it was not.
 */
export type UpdateTicket = (change: TicketActionInput, successMessage: string) => Promise<boolean>;

/**
 * The server actions available on one staff ticket. Every action shares one
 * busy flag and one inline error, and on success hands the server's updated
 * ticket back to the dashboard, so the UI always shows server-validated data.
 */
export function useTicketActions(ticket: StaffTicket, staffKey: string, onUpdated: TicketUpdatedHandler) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ticketPath = `/api/tickets/${ticket.id}`;

  async function run(path: string, request: KeyedRequestOptions, successMessage: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    const outcome = await settle(staffRequest<StaffTicket>(path, staffKey, request), failureMessages(t));
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return false;
    }
    onUpdated(outcome.data, `${ticket.id}: ${successMessage}`);
    return true;
  }

  /** Applies a workflow action (accept, transfer, review, note, admin override). */
  const update: UpdateTicket = (change, successMessage) =>
    run(ticketPath, { method: "PATCH", json: change }, successMessage);

  /** Marks the ticket fixed, with the department's note and optional after photo. */
  function resolve(note: string, afterPhoto: Blob | null) {
    const form = new FormData();
    form.set("note", note);
    if (afterPhoto) form.set("photo", afterPhoto, "after.jpg");
    return run(`${ticketPath}/resolve`, { method: "POST", form }, "marked fixed, awaiting citizen");
  }

  /** Sends a message to the citizen. Returns an error message, or null on success. */
  async function sendMessage(text: string): Promise<string | null> {
    const outcome = await settle(
      staffRequest<StaffTicket>(`${ticketPath}/messages`, staffKey, { method: "POST", json: { text } }),
      failureMessages(t, "chat.error.send"),
    );
    if (!outcome.ok) return outcome.error;
    onUpdated(outcome.data, `${ticket.id}: message sent`);
    return null;
  }

  return { busy, error, update, resolve, sendMessage };
}
