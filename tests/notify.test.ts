// Email relay to reporters (src/lib/notify.ts), with the SMTP transport mocked:
// only reporters who left an email are written to, each with their own private
// link; nothing is sent when email is off; a failed send is logged, never thrown,
// and the log never contains an address.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ticket } from "@/lib/types";
import { newReporter } from "@/lib/workflow";

const sendMail = vi.fn<(mail: { to: string; subject: string; text: string }) => Promise<unknown>>();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock("nodemailer", () => ({ createTransport }));

const withEmail = newReporter("citizen@example.com");
const second = newReporter("neighbour@example.com");
const anonymous = newReporter(null);
const ticket = {
  id: "CR-5001",
  title: "Water leak near the park",
  status: "In Progress",
  reporters: [withEmail.reporter, anonymous.reporter, second.reporter],
} as Ticket;

/** A fresh copy of notify.ts, so its cached transport follows this test's SMTP_URL. */
const loadNotify = () => import("@/lib/notify");
/** Every log line written while `run` runs, as one string. */
async function captureLogs(run: () => Promise<unknown>) {
  vi.stubEnv("LOG_SILENT", "");
  const lines: unknown[] = [];
  const record = (line: unknown) => void lines.push(line);
  vi.spyOn(console, "log").mockImplementation(record);
  vi.spyOn(console, "error").mockImplementation(record);
  await run();
  return lines.join("\n");
}

beforeEach(() => {
  vi.resetModules();
  sendMail.mockReset();
  createTransport.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("notifyReporters", () => {
  it("sends nothing, and loads no mailer, while email is not configured", async () => {
    vi.stubEnv("SMTP_URL", "");
    const { emailEnabled, notifyReporters } = await loadNotify();
    expect(emailEnabled()).toBe(false);
    expect(await notifyReporters(ticket, "Update", "Crew assigned.", "https://civic.example")).toBe(0);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("writes only to reporters who left an email, each with their own private link", async () => {
    vi.stubEnv("SMTP_URL", "smtp://relay.example:25");
    sendMail.mockResolvedValue({});
    const { emailEnabled, notifyReporters } = await loadNotify();
    expect(emailEnabled()).toBe(true);
    expect(await notifyReporters(ticket, "Update", "Crew assigned.", "https://civic.example")).toBe(2);
    expect(sendMail.mock.calls.map(([mail]) => mail.to)).toEqual(["citizen@example.com", "neighbour@example.com"]);
    const [[first]] = sendMail.mock.calls;
    expect(first.subject).toBe("[CR-5001] Update");
    expect(first.text).toContain("Crew assigned.");
    expect(first.text).toContain(`https://civic.example/track/CR-5001?k=${encodeURIComponent(withEmail.token)}`);
    expect(first.text).not.toContain(second.token);
  });

  it("does nothing for a ticket whose reporters left no email", async () => {
    vi.stubEnv("SMTP_URL", "smtp://relay.example:25");
    const { notifyReporters } = await loadNotify();
    expect(await notifyReporters({ ...ticket, reporters: [anonymous.reporter] }, "s", "b", "https://x")).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("logs a failed send without the address, and still tries the others", async () => {
    vi.stubEnv("SMTP_URL", "smtp://relay.example:25");
    sendMail.mockRejectedValueOnce(new Error("550 mailbox unavailable")).mockResolvedValueOnce({});
    const { notifyReporters } = await loadNotify();
    let sent = -1;
    const logs = await captureLogs(async () => {
      sent = await notifyReporters(ticket, "Update", "Crew assigned.", "https://civic.example");
    });
    expect(sent).toBe(1);
    expect(logs).toContain("email_failed");
    expect(logs).toContain("550 mailbox unavailable");
    expect(logs).not.toContain("@example.com");
    expect(logs).not.toContain(withEmail.token);
  });
});
