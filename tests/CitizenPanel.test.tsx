// @vitest-environment jsdom
// The citizen's private panel (confirm or reopen a reported fix) and the conversation it shares
// with the staff cards.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CitizenPanel from "@/app/track/[id]/CitizenPanel";
import { FixedLanguage, I18nProvider } from "@/components/I18nProvider";
import MessageThread from "@/components/MessageThread";
import { createTranslator } from "@/lib/i18n";
import type { Message } from "@/lib/types";
import { expectNoAxeViolations, jsonResponse, makeTicket, stubFetch } from "./setup";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const t = createTranslator("en");

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

const resolved = makeTicket({ status: "Resolved", citizenConfirmation: "pending" });

function renderPanel(ticket = resolved) {
  const view = render(
    <I18nProvider initialLang="en">
      <CitizenPanel ticket={ticket} token="secret" />
    </I18nProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

describe("CitizenPanel", () => {
  it("confirms the fix with the private key, refreshes the page and announces it", async () => {
    const fetchMock = stubFetch(jsonResponse(makeTicket({ status: "Resolved", citizenConfirmation: "confirmed" })));
    const { user } = renderPanel();
    await user.click(screen.getByRole("button", { name: t("panel.yes") }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/tickets/CR-1001/confirm");
    expect(init?.headers).toEqual({ "x-citizen-key": "secret" });
    expect((init?.body as FormData).get("decision")).toBe("confirm");
    expect(screen.getByRole("status")).toHaveTextContent(t("panel.confirmed"));
  });

  it("reopens only with a note, sending it with the decision", async () => {
    const fetchMock = stubFetch(jsonResponse(makeTicket({ status: "In Progress" })));
    const { user } = renderPanel();
    await user.click(screen.getByRole("button", { name: t("panel.no") }));
    const note = screen.getByLabelText(t("panel.whatWrong"));
    expect(note).toBeRequired();

    await user.type(note, "Still a hole");
    await user.click(screen.getByRole("button", { name: t("panel.reopen") }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get("decision")).toBe("reopen");
    expect(body.get("note")).toBe("Still a hole");
    expect(screen.getByRole("status")).toHaveTextContent(t("panel.reopened"));
  });

  it("shows the server's error, keeps the question and re-enables the buttons", async () => {
    stubFetch(jsonResponse({ error: "Too many requests. Try again shortly." }, 429));
    const { user } = renderPanel();
    await user.click(screen.getByRole("button", { name: t("panel.yes") }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests. Try again shortly.");
    expect(screen.getByRole("button", { name: t("panel.yes") })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a network failure instead of staying busy", async () => {
    stubFetch(new TypeError("offline"));
    const { user } = renderPanel();
    await user.click(screen.getByRole("button", { name: t("panel.yes") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("common.error.network"));
    expect(screen.getByRole("button", { name: t("panel.yes") })).toBeEnabled();
  });

  it("sends a message to the department with the private key and shows the updated thread", async () => {
    const reply = { id: "m9", from: "citizen" as const, text: "Thanks", lang: "en", at: resolved.createdAt };
    const fetchMock = stubFetch(jsonResponse(makeTicket({ messages: [reply] })));
    const { user } = renderPanel();
    await user.type(screen.getByLabelText(t("chat.write")), "Thanks");
    await user.click(screen.getByRole("button", { name: t("chat.send") }));

    expect(await screen.findByText("Thanks", { selector: "p" })).toBeVisible();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/CR-1001/messages");
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      "x-citizen-key": "secret",
      "content-type": "application/json",
    });
  });

  it("asks nothing once the citizen has confirmed", () => {
    renderPanel(makeTicket({ status: "Resolved", citizenConfirmation: "confirmed" }));
    expect(screen.queryByRole("button", { name: t("panel.yes") })).not.toBeInTheDocument();
    expect(screen.getByText(t("panel.confirmed"))).toBeVisible();
  });

  it("marks the English department name inside a translated heading", () => {
    render(
      <FixedLanguage lang="ta">
        <CitizenPanel ticket={resolved} token="secret" />
      </FixedLanguage>,
    );
    expect(screen.getByText(resolved.department)).toHaveAttribute("lang", "en");
  });

  it("has no axe violations", async () => {
    const { container } = renderPanel();
    await expectNoAxeViolations(container);
  });
});

const MESSAGES: Message[] = [
  {
    id: "m1",
    from: "citizen",
    text: "இன்னும் சரியாகவில்லை",
    lang: "ta",
    translation: "Still not fixed",
    at: resolved.createdAt,
  },
  {
    id: "m2",
    from: "department",
    text: "Crew on the way",
    lang: "en",
    translation: "குழு வருகிறது",
    at: resolved.createdAt,
  },
];

function renderThread(onSend: (text: string) => Promise<string | null>, viewer: "citizen" | "staff" = "citizen") {
  return render(
    <FixedLanguage lang="en">
      <MessageThread messages={MESSAGES} viewer={viewer} citizenLanguage="ta" onSend={onSend} />
    </FixedLanguage>,
  );
}

describe("MessageThread", () => {
  it("sends the trimmed draft and clears it on success", async () => {
    const onSend = vi.fn().mockResolvedValue(null);
    const user = userEvent.setup();
    renderThread(onSend);
    const input = screen.getByLabelText(t("chat.write"));
    await user.type(input, "  Thank you  ");
    await user.click(screen.getByRole("button", { name: t("chat.send") }));

    expect(onSend).toHaveBeenCalledWith("Thank you");
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("keeps the draft and ties the error to the field when sending fails", async () => {
    const user = userEvent.setup();
    renderThread(vi.fn().mockResolvedValue("Couldn't send."));
    const input = screen.getByLabelText(t("chat.write"));
    await user.type(input, "Hello");
    await user.click(screen.getByRole("button", { name: t("chat.send") }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't send.");
    expect(input).toHaveValue("Hello");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Couldn't send.");
  });

  it("ignores an empty draft", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    renderThread(onSend);
    await user.type(screen.getByLabelText(t("chat.write")), "   ");
    await user.click(screen.getByRole("button", { name: t("chat.send") }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("gives each thread its own field, so two on one page keep their labels", () => {
    render(
      <FixedLanguage lang="en">
        <MessageThread messages={[]} viewer="staff" citizenLanguage="ta" onSend={vi.fn()} />
        <MessageThread messages={[]} viewer="staff" citizenLanguage="hi" onSend={vi.fn()} />
      </FixedLanguage>,
    );
    const [first, second] = screen.getAllByLabelText(t("chat.write"));
    expect(first.id).not.toBe(second.id);
  });

  it("keeps the list inside a labelled log and marks each translation's language", () => {
    renderThread(vi.fn(), "staff");
    const log = screen.getByRole("log", { name: t("chat.label") });
    expect(log.querySelector("ol")).not.toBeNull();
    expect(screen.getByText("Still not fixed")).toHaveAttribute("lang", "en");
    expect(screen.getByText("குழு வருகிறது")).toHaveAttribute("lang", "ta");
    expect(screen.getByText("இன்னும் சரியாகவில்லை")).toHaveAttribute("lang", "ta");
  });

  it("has no axe violations", async () => {
    const { container } = renderThread(vi.fn());
    await expectNoAxeViolations(container);
  });
});
