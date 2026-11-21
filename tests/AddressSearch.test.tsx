// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import AddressSearch from "@/components/AddressSearch";
import { I18nProvider } from "@/components/I18nProvider";
import { createTranslator } from "@/lib/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const t = createTranslator("en");
const SUGGESTIONS = [
  { id: "p1", main: "Katpadi Bus Stand", secondary: "Katpadi, Vellore", lat: 12.97, lng: 79.14 },
  { id: "p2", main: "Katpadi Junction", secondary: "Vellore" },
];

/** Replies to /api/places with the given suggestions (search) or place details (lookup by id). */
function mockPlaces(suggestions: unknown[]) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.includes("id=") ? { lat: 12.9, lng: 79.1, address: "Katpadi Junction, Vellore" } : { suggestions };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setup(onSelect = vi.fn()) {
  const user = userEvent.setup();
  render(
    <I18nProvider initialLang="en">
      <AddressSearch provider="google" onSelect={onSelect} />
    </I18nProvider>,
  );
  return { user, onSelect, input: screen.getByRole("combobox", { name: t("search.label") }) };
}

describe("AddressSearch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists suggestions after typing and pins the one that is clicked", async () => {
    mockPlaces(SUGGESTIONS);
    const { user, input, onSelect } = setup();
    await user.type(input, "Katpadi");
    const option = await screen.findByRole("option", { name: /Katpadi Bus Stand/ });
    expect(input).toHaveAttribute("aria-expanded", "true");

    await user.pointer({ keys: "[MouseLeft>]", target: option });
    expect(onSelect).toHaveBeenCalledWith({ lat: 12.97, lng: 79.14, address: "Katpadi Bus Stand, Katpadi, Vellore" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("moves with the arrow keys and chooses with Enter, fetching details when needed", async () => {
    const fetchMock = mockPlaces(SUGGESTIONS);
    const { user, input, onSelect } = setup();
    await user.type(input, "Katpadi");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect).toHaveBeenCalledWith({ lat: 12.9, lng: 79.1, address: "Katpadi Junction, Vellore" });
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("id=p2"), expect.anything());
  });

  it("clears and closes the list when the query becomes too short", async () => {
    mockPlaces(SUGGESTIONS);
    const { user, input } = setup();
    await user.type(input, "Katpadi");
    await screen.findByRole("listbox");

    await user.clear(input);
    await user.type(input, "Ka");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a visible message when nothing matches, without opening an empty list", async () => {
    mockPlaces([]);
    const { user, input } = setup();
    await user.type(input, "Nowhere");
    expect(await screen.findByRole("alert")).toHaveTextContent(t("search.noMatches"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the failure message when the search request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { user, input } = setup();
    await user.type(input, "Katpadi");
    expect(await screen.findByRole("alert")).toHaveTextContent(t("search.failed"));
  });

  it("marks the combobox busy while a lookup is in flight", async () => {
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (finish = resolve))),
    );
    const { user, input } = setup();
    await user.type(input, "Katpadi");
    await waitFor(() => expect(input).toHaveAttribute("aria-busy", "true"));
    finish(new Response(JSON.stringify({ suggestions: [] }), { status: 200 }));
    await waitFor(() => expect(input).toHaveAttribute("aria-busy", "false"));
  });

  it("closes on Escape", async () => {
    mockPlaces(SUGGESTIONS);
    const { user, input } = setup();
    await user.type(input, "Katpadi");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("uses a new session token for the search after a suggestion with coordinates was chosen", async () => {
    let counter = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `token-${++counter}` });
    const fetchMock = mockPlaces(SUGGESTIONS);
    const { user, input } = setup();
    await user.type(input, "Katpadi");
    const option = await screen.findByRole("option", { name: /Katpadi Bus Stand/ });
    await user.pointer({ keys: "[MouseLeft>]", target: option });
    await user.clear(input);
    await user.type(input, "Vellore");
    // One search per typed query, none for the choice itself (its coordinates came with it).
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const sessions = fetchMock.mock.calls.map(([url]) => /session=([^&]+)/.exec(url)?.[1]);
    expect(sessions[0]).toBe("token-1");
    expect(sessions.at(-1)).toBe("token-2");
  });
});
