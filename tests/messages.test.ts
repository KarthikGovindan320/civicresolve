// The department ↔ citizen conversation rules (src/lib/services/messages.ts):
// who may post, which language a message is translated into, and the email relay.
import { describe, expect, it } from "vitest";
import { messageAuthor, messageNotice, postMessage, translationTarget } from "@/lib/services/messages";
import type { Role, Ticket } from "@/lib/types";
import { makeMessage, newReporter } from "@/lib/workflow";

const { token, reporter } = newReporter(null, "2026-11-10T00:00:00.000Z");
const ELECTRICITY: Role = { role: "department", department: "Electricity Board (TANGEDCO)" };
const ROADS: Role = { role: "department", department: "Public Works (Roads)" };
const SENT_AT = "2026-11-21T12:00:00.000Z";

/** A Tamil-language streetlight report with one reporter, owned by the electricity board. */
const streetlight = (changes: Partial<Ticket> = {}) =>
  ({
    id: "CR-4001",
    department: "Electricity Board (TANGEDCO)",
    originalLanguage: "ta",
    status: "Reported",
    updatedAt: "2026-11-10T00:00:00.000Z",
    reporters: [reporter],
    messages: [],
    ...changes,
  }) as Ticket;

describe("who is posting", () => {
  it("is the responsible staff, then a holder of the private link, otherwise nobody", () => {
    expect(messageAuthor(streetlight(), { role: { role: "admin" }, citizenToken: null })).toBe("admin");
    expect(messageAuthor(streetlight(), { role: ELECTRICITY, citizenToken: null })).toBe("department");
    expect(messageAuthor(streetlight(), { role: null, citizenToken: token })).toBe("citizen");
    expect(messageAuthor(streetlight(), { role: ROADS, citizenToken: null })).toBeNull();
    expect(messageAuthor(streetlight(), { role: null, citizenToken: "guessed" })).toBeNull();
  });

  it("keeps departments out of reports held for review", () => {
    expect(messageAuthor(streetlight({ verification: "unverified" }), { role: ELECTRICITY, citizenToken: null })).toBe(
      null,
    );
  });
});

describe("translation target", () => {
  it("is English for the citizen's messages and the citizen's language for staff replies", () => {
    expect(translationTarget(streetlight(), "citizen")).toBe("en");
    expect(translationTarget(streetlight(), "department")).toBe("ta");
    expect(translationTarget(streetlight({ originalLanguage: "" }), "admin")).toBe("en");
  });
});

describe("posting", () => {
  const reply = makeMessage({ from: "department", text: "Crew dispatched", lang: "en", translation: "குழு" }, SENT_AT);

  it("appends the message and stamps the ticket as updated", () => {
    const result = postMessage(streetlight(), reply, { role: ELECTRICITY, citizenToken: null });
    if (!result.ok) throw new Error(result.error);
    expect(result.ticket.messages).toEqual([reply]);
    expect(result.ticket.updatedAt).toBe(SENT_AT);
  });

  it("is refused when the ticket was transferred away while the message was translated", () => {
    const transferred = streetlight({ department: "Public Works (Roads)" });
    expect(postMessage(transferred, reply, { role: ELECTRICITY, citizenToken: null })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("relays staff messages to the citizen by email, with the translation, but not the citizen's own", () => {
    expect(messageNotice(reply)).toEqual({
      subject: "New message about your issue",
      text: "Crew dispatched\n\nகுழு",
    });
    expect(messageNotice({ ...reply, translation: null })?.text).toBe("Crew dispatched");
    expect(messageNotice({ ...reply, from: "citizen" })).toBeNull();
  });
});
