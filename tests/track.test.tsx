// @vitest-environment jsdom
// The public tracking pages: the filterable list on /track, and the server-rendered ticket page
// with its title, visibility rule for held reports, and the language marking of mixed text.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TicketPage, { generateMetadata } from "@/app/track/[id]/page";
import TrackPage from "@/app/track/page";
import { I18nProvider } from "@/components/I18nProvider";
import { createTranslator } from "@/lib/i18n";
import type { Ticket } from "@/lib/types";
import { newReporter } from "@/lib/workflow";
import { expectNoAxeViolations, jsonResponse, makeTicket, stubFetch } from "./setup";

const stored = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/store", () => ({ store: () => ({ get: async (id: string) => stored.get(id) ?? null }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
// Leaflet needs a real layout engine; the pages only need to pass the map its name and tickets.
vi.mock("@/components/LazyMap", () => ({
  default: ({ label, tickets = [] }: { label: string; tickets?: unknown[] }) => (
    <div role="region" aria-label={label} data-count={tickets.length} />
  ),
}));

const t = createTranslator("en");

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
});

const TICKETS = [
  makeTicket({ id: "CR-1", title: "குழி சாலையில்", originalLanguage: "ta" }),
  makeTicket({ id: "CR-2", title: "Garbage pile", category: "Garbage", department: "Sanitation", reporterCount: 3 }),
  makeTicket({ id: "CR-3", title: "Fixed light", category: "Streetlight", status: "Resolved", overdue: true }),
];

function renderTrack() {
  const view = render(
    <I18nProvider initialLang="en">
      <TrackPage />
    </I18nProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

describe("/track", () => {
  it("lists every ticket with its title and department marked with their languages", async () => {
    stubFetch(jsonResponse(TICKETS));
    renderTrack();
    const title = await screen.findByText("குழி சாலையில்");
    expect(title).toHaveAttribute("lang", "ta");
    // In the list and in the department statistics.
    for (const name of screen.getAllByText("Sanitation")) expect(name).toHaveAttribute("lang", "en");
    expect(screen.getByText(t("common.reporters", { count: 3 }))).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(t("track.shown", { count: 3 }));
  });

  it("filters the list and the map together and announces the new count", async () => {
    stubFetch(jsonResponse(TICKETS));
    const { user } = renderTrack();
    await screen.findByText("Garbage pile");
    await user.selectOptions(screen.getByLabelText(t("track.filterCategory")), "Garbage");

    expect(screen.getByRole("status")).toHaveTextContent(t("track.shown", { count: 1 }));
    expect(screen.getByRole("region", { name: t("map.cityLabel") })).toHaveAttribute("data-count", "1");
    expect(screen.queryByText("Fixed light")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(t("track.filterStatus")), "In Progress");
    expect(screen.getByText(t("track.noMatch"))).toBeVisible();
  });

  it("shows a translated alert when the list cannot be loaded", async () => {
    stubFetch(new TypeError("offline"));
    renderTrack();
    expect(await screen.findByRole("alert")).toHaveTextContent(t("track.loadError"));
  });

  it("has no axe violations", async () => {
    stubFetch(jsonResponse(TICKETS));
    const { container } = renderTrack();
    await screen.findByText("Garbage pile");
    await expectNoAxeViolations(container);
  });
});

/** Stores a ticket as the database holds it (with reporters), returning its private-link token. */
function storeTicket(overrides: Partial<Ticket>) {
  const { token, reporter } = newReporter(null);
  // The view-only fields (message count, target date, overdue) are recomputed by the page.
  const ticket = makeTicket(overrides);
  stored.set(ticket.id, { ...ticket, reporters: [reporter] });
  return token;
}

const pageProps = (id: string, k?: string) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(k ? { k } : {}),
});

async function renderTicketPage(id: string, k?: string) {
  render(<I18nProvider initialLang="en">{await TicketPage(pageProps(id, k))}</I18nProvider>);
}

describe("/track/[id]", () => {
  const resolvedTicket: Partial<Ticket> = {
    id: "CR-7",
    title: "குழி",
    originalLanguage: "ta",
    status: "Resolved",
    hasImage: true,
    citizenConfirmation: "pending",
    history: [{ status: "Resolved", at: "2026-11-02T06:00:00.000Z", note: "Patched by the road crew" }],
    resolution: {
      note: "Filled the pothole",
      hasPhoto: true,
      aiVerdict: "fixed",
      aiReason: "The hole is gone",
      by: "Public Works (Roads)",
      at: "2026-11-02T06:00:00.000Z",
    },
  };

  it("titles the page with the ticket id and title", async () => {
    storeTicket({ id: "CR-7", title: "Pothole" });
    expect(await generateMetadata(pageProps("cr-7"))).toEqual({ title: "CR-7: Pothole" });
  });

  it("never reveals a held report, in the title or the page, except to its reporter", async () => {
    const token = storeTicket({ id: "CR-8", title: "Unscreened", verification: "unverified" });
    expect(await generateMetadata(pageProps("CR-8"))).toEqual({ title: t("notFound.ticketTitle") });
    await expect(TicketPage(pageProps("CR-8"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await generateMetadata(pageProps("CR-8", token))).toEqual({ title: "CR-8: Unscreened" });
    await renderTicketPage("CR-8", token);
    const held = screen.getAllByRole("status").find((element) => element.textContent?.includes("Public Works (Roads)"));
    expect(held).toHaveTextContent(t("ticket.heldNotice", { department: "Public Works (Roads)" }));
  });

  it("treats an unknown id as not found", async () => {
    expect(await generateMetadata(pageProps("CR-404"))).toEqual({ title: t("notFound.ticketTitle") });
    await expect(TicketPage(pageProps("CR-404"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("marks citizen and staff text with its own language", async () => {
    storeTicket(resolvedTicket);
    await renderTicketPage("CR-7");
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("lang", "ta");
    expect(screen.getByText("Patched by the road crew")).toHaveAttribute("lang", "en");
    expect(screen.getByText("Filled the pothole")).toHaveAttribute("lang", "en");
    const proof = screen.getByRole("region", { name: t("ticket.proof") });
    for (const name of within(proof).getAllByText("Public Works (Roads)")) expect(name).toHaveAttribute("lang", "en");
    expect(screen.getByRole("region", { name: t("map.ticketLabel") })).toBeInTheDocument();
  });

  it("shows the private panel with the reporter's link", async () => {
    const token = storeTicket(resolvedTicket);
    await renderTicketPage("CR-7", token);
    expect(screen.getByRole("region", { name: t("panel.heading") })).toBeVisible();
  });

  it("warns when the private link does not match", async () => {
    storeTicket(resolvedTicket);
    await renderTicketPage("CR-7", "wrong-token");
    expect(screen.getByRole("alert")).toHaveTextContent(t("ticket.badLink"));
    expect(screen.queryByRole("region", { name: t("panel.heading") })).not.toBeInTheDocument();
  });

  it("marks the current step and has no axe violations", async () => {
    storeTicket({ id: "CR-9", status: "In Progress", acknowledgedAt: "2026-11-01T08:00:00.000Z", transfers: 1 });
    await renderTicketPage("CR-9");
    const steps = screen.getByRole("list", { name: t("ticket.progress") });
    expect(within(steps).getByText(t("status.In Progress")).closest("li")).toHaveAttribute("aria-current", "step");
    await waitFor(() => expect(screen.getByText(t("ticket.handoffs"))).toBeVisible());
    await expectNoAxeViolations(document.body);
  });
});
