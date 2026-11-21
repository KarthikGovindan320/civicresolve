import "server-only";
import { log } from "./log";
import type { Ticket } from "./types";
import { privateLink, tokenFor } from "./workflow";

// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT][GOOGLE SERVICES][SECURITY] EMAIL NOTIFICATIONS
// -----------------------------------------------------------------------------
// Citizens who leave an (optional) email address are told when their issue is
// acknowledged, transferred, messaged about or fixed, with their private link
// so they can reply or confirm the fix.
//   • Privacy relay: the SERVER sends the email. Department staff never see the
//     address, and it is never returned by any API.
//   • Works with Gmail / Google Workspace SMTP (an app password via SMTP_URL,
//     e.g. smtps://you%40gmail.com:app-password@smtp.gmail.com:465). The
//     credential lives in Secret Manager in production.
//   • Optional and non-blocking: if SMTP_URL isn't set, or sending fails, the
//     update is still saved and shown on the citizen's private page. A
//     notification failure never fails the request.
// =============================================================================

type Transport = { sendMail: (m: object) => Promise<unknown> };
let transport: Transport | null | undefined;

async function getTransport(): Promise<Transport | null> {
  if (transport !== undefined) return transport;
  if (!process.env.SMTP_URL) return (transport = null);
  const nodemailer = await import("nodemailer"); // loaded only when email is configured
  transport = nodemailer.createTransport(process.env.SMTP_URL);
  return transport;
}

// Absolute link for emails. PUBLIC_BASE_URL is the Cloud Run URL in production;
// otherwise we use the origin of the request that triggered the update.
export function baseUrl(req: Request): string {
  return (process.env.PUBLIC_BASE_URL || new URL(req.url).origin).replace(/\/$/, "");
}

export const emailEnabled = () => Boolean(process.env.SMTP_URL);

/**
 * Notify every reporter of `t` who left an email. Each reporter gets their OWN
 * private link (tokens are per-reporter), so they can reply or confirm the fix
 * straight from the email.
 */
export async function notifyReporters(t: Ticket, subject: string, body: string, origin: string): Promise<number> {
  const recipients = (t.reporters ?? []).filter((r) => r.email);
  if (!recipients.length) return 0;
  const tx = await getTransport();
  if (!tx) {
    log.info("email_skipped", { id: t.id, reason: "SMTP_URL not set", recipients: recipients.length });
    return 0;
  }
  let sent = 0;
  for (const r of recipients) {
    const to = r.email!;
    const link = privateLink(origin, t.id, tokenFor(r.salt));
    try {
      await tx.sendMail({
        from: process.env.SMTP_FROM || "CivicResolve <no-reply@civicresolve.app>",
        to,
        subject: `[${t.id}] ${subject}`,
        text: `${body}\n\nIssue: ${t.title}\nStatus: ${t.status}\n\nView and reply: ${link}\n\nYou received this because you reported this issue on CivicResolve.`,
      });
      sent++;
    } catch (e) {
      // Log the failure without the address (privacy).
      log.warn("email_failed", { id: t.id, error: String(e).slice(0, 200) });
    }
  }
  log.info("email_sent", { id: t.id, sent });
  return sent;
}
