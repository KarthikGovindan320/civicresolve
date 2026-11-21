import "server-only";
import { describeError, log } from "./log";
import type { Ticket } from "./types";
import { privateLink, tokenFor } from "./workflow";

// =============================================================================
// Email notifications
// -----------------------------------------------------------------------------
// Citizens who leave an (optional) email address are told when their issue is
// acknowledged, transferred, messaged about or fixed, with their private link
// so they can reply or confirm the fix.
//   • Privacy relay: the server sends the email. Department staff never see the
//     address, and it is never returned by any API.
//   • Works with Gmail / Google Workspace SMTP (an app password via SMTP_URL,
//     e.g. smtps://you%40gmail.com:app-password@smtp.gmail.com:465). The
//     credential lives in Secret Manager in production.
//   • Optional and non-blocking: if SMTP_URL isn't set, or sending fails, the
//     update is still saved and shown on the citizen's private page. A
//     notification failure never fails the request.
// =============================================================================

const DEFAULT_SENDER = "CivicResolve <no-reply@civicresolve.app>";

type Transport = { sendMail: (mail: object) => Promise<unknown> };
/** undefined = not looked up yet; null = email is not configured. */
let cachedTransport: Transport | null | undefined;

async function getTransport(): Promise<Transport | null> {
  if (cachedTransport !== undefined) return cachedTransport;
  if (!process.env.SMTP_URL) return (cachedTransport = null);
  const nodemailer = await import("nodemailer"); // loaded only when email is configured
  cachedTransport = nodemailer.createTransport(process.env.SMTP_URL);
  return cachedTransport;
}

/** Whether outgoing email is configured. */
export const emailEnabled = () => Boolean(process.env.SMTP_URL);

/**
 * Notify every reporter of `ticket` who left an email, and return how many
 * emails were sent. Each reporter gets their own private link (tokens are
 * per-reporter), so they can reply or confirm the fix straight from the email.
 */
export async function notifyReporters(ticket: Ticket, subject: string, body: string, origin: string): Promise<number> {
  const recipients = (ticket.reporters ?? []).flatMap((reporter) =>
    reporter.email ? [{ email: reporter.email, salt: reporter.salt }] : [],
  );
  if (!recipients.length) return 0;
  const transport = await getTransport();
  if (!transport) {
    log.info("email_skipped", { id: ticket.id, reason: "SMTP_URL not set", recipients: recipients.length });
    return 0;
  }
  let sentCount = 0;
  for (const recipient of recipients) {
    const link = privateLink(origin, ticket.id, tokenFor(recipient.salt));
    try {
      await transport.sendMail({
        from: process.env.SMTP_FROM || DEFAULT_SENDER,
        to: recipient.email,
        subject: `[${ticket.id}] ${subject}`,
        text: `${body}\n\nIssue: ${ticket.title}\nStatus: ${ticket.status}\n\nView and reply: ${link}\n\nYou received this because you reported this issue on CivicResolve.`,
      });
      sentCount++;
    } catch (error) {
      // Log the failure without the address (privacy).
      log.warn("email_failed", { id: ticket.id, error: describeError(error) });
    }
  }
  log.info("email_sent", { id: ticket.id, sent: sentCount });
  return sentCount;
}
