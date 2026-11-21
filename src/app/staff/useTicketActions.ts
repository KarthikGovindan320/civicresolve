"use client";

import { useState } from "react";
import { type KeyedRequestOptions, staffRequest } from "@/lib/client/api";
import type { StaffTicket } from "./types";

/** Called with the server's updated ticket and a short confirmation for the status line. */
export type TicketUpdatedHandler = (ticket: StaffTicket, confirmation: string) => void;

/** Sends a change to the ticket; `successMessage` is announced once the server accepts it. */
export type UpdateTicket = (change: object, successMessage: string) => Promise<void>;

/**
 * The server actions available on one staff ticket. Every action shares one
 * busy flag and one inline error, and on success hands the server's updated
 * ticket back to the dashboard, so the UI always shows server-validated data.
 */
export function useTicketActions(ticket: StaffTicket, staffKey: string, onUpdated: TicketUpdatedHandler) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ticketPath = `/api/tickets/${ticket.id}`;

  async function run(path: string, request: KeyedRequestOptions, successMessage: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await staffRequest<StaffTicket>(path, staffKey, request);
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else onUpdated(result.data, `${ticket.id}: ${successMessage}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
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
    const result = await staffRequest<StaffTicket>(`${ticketPath}/messages`, staffKey, {
      method: "POST",
      json: { text },
    });
    if (!result.ok) return result.error ?? "Couldn't send.";
    onUpdated(result.data, `${ticket.id}: message sent`);
    return null;
  }

  return { busy, error, update, resolve, sendMessage };
}
