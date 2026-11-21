// @vitest-environment jsdom
// The staff portal: sign-in errors from the server, the work-queue switcher, load failures, and
// where focus goes when an action moves a ticket out of the queue on screen.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "@/app/staff/Dashboard";
import StaffPage from "@/app/staff/page";
import type { Session } from "@/app/staff/types";
import { FixedLanguage } from "@/components/I18nProvider";
import { expectNoAxeViolations, jsonResponse, makeTicket, stubFetch } from "./setup";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ADMIN: Session = { role: "admin", label: "City admin", gemini: true, email: false };
const ROADS: Session = {
  role: "department",
  department: "Public Works (Roads)",
  label: "Public Works (Roads)",
  gemini: true,
  email: false,
};

const TICKETS = [
  makeTicket({ id: "CR-1", title: "Pothole one" }),
  makeTicket({ id: "CR-2", title: "Pothole two", status: "In Progress" }),
  makeTicket({ id: "CR-3", title: "Bins overflowing", department: "Sanitation" }),
  makeTicket({ id: "CR-4", title: "Unscreened report", verification: "unverified" }),
];

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function renderDashboard(session: Session) {
  return render(
    <FixedLanguage lang="en">
      <Dashboard staffKey="key" session={session} onLogout={vi.fn()} />
    </FixedLanguage>,
  );
}

const queueButton = (name: RegExp) => screen.getByRole("button", { name });

describe("staff sign-in", () => {
  it.each([
    [401, "Wrong passcode."],
    [429, "Too many attempts. Try again in a minute."],
  ])("shows the server's message for a %i, tied to the passcode field", async (status, message) => {
    stubFetch(jsonResponse({ error: message }, status));
    const user = userEvent.setup();
    render(<StaffPage />);
    await user.type(screen.getByLabelText("Passcode"), "guess");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    const field = screen.getByLabelText("Passcode");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(message);
  });

  it("falls back to its own message when the server sends none, and to a network message offline", async () => {
    stubFetch(jsonResponse({}, 401), new TypeError("offline"));
    const user = userEvent.setup();
    render(<StaffPage />);
    await user.type(screen.getByLabelText("Passcode"), "guess");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong passcode.");

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Network error. Please try again."));
  });

  it("opens the dashboard for a valid passcode and remembers it for this tab", async () => {
    stubFetch(jsonResponse(ROADS), jsonResponse(TICKETS));
    const user = userEvent.setup();
    render(<StaffPage />);
    await user.type(screen.getByLabelText("Passcode"), "roads-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Public Works (Roads): work queue" })).toBeVisible();
    expect(sessionStorage.getItem("civic-staff-key")).toBe("roads-pass");
  });
});

describe("staff dashboard", () => {
  it("switches queues with pressed buttons and names the shown queue in a heading", async () => {
    stubFetch(jsonResponse(TICKETS));
    const user = userEvent.setup();
    renderDashboard(ROADS);

    const toAccept = await screen.findByRole("button", { name: /To accept/ });
    expect(screen.getByRole("group", { name: "Work queues" })).toContainElement(toAccept);
    expect(toAccept).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2, name: "To accept" })).toBeVisible();
    expect(screen.getByText("Pothole one")).toBeVisible();

    await user.click(queueButton(/In progress/));
    expect(queueButton(/In progress/)).toHaveAttribute("aria-pressed", "true");
    expect(toAccept).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { level: 2, name: "In progress" })).toBeVisible();
    expect(screen.getByText("Pothole two")).toBeVisible();
    expect(screen.queryByText("Pothole one")).not.toBeInTheDocument();
  });

  it("counts only the department's own, screened tickets and hides the admin-only queues", async () => {
    stubFetch(jsonResponse(TICKETS));
    renderDashboard(ROADS);
    expect(await screen.findByRole("button", { name: "To accept (1)" })).toBeVisible();
    expect(queueButton(/^All/)).toHaveAccessibleName("All (2)");
    expect(screen.queryByRole("button", { name: /Unverified/ })).not.toBeInTheDocument();
  });

  it("gives the admin every department, the review queue and a department filter", async () => {
    stubFetch(jsonResponse(TICKETS));
    const user = userEvent.setup();
    renderDashboard(ADMIN);
    expect(await screen.findByRole("button", { name: "Unverified (1)" })).toBeVisible();
    expect(queueButton(/^All/)).toHaveAccessibleName("All (3)");

    await user.selectOptions(screen.getByLabelText("Department"), "Sanitation");
    expect(queueButton(/^All/)).toHaveAccessibleName("All (1)");
  });

  it("shows a load failure as an alert instead of loading forever", async () => {
    stubFetch(jsonResponse({ error: "Too many requests. Try again shortly." }, 429));
    renderDashboard(ROADS);
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests. Try again shortly.");
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("moves focus to the status line when an action takes the ticket out of the queue", async () => {
    const accepted = makeTicket({ id: "CR-1", title: "Pothole one", status: "In Progress" });
    stubFetch(jsonResponse(TICKETS), jsonResponse(accepted));
    const user = userEvent.setup();
    renderDashboard(ROADS);
    fireEvent.click(await screen.findByText("Pothole one"));
    await user.click(screen.getByRole("button", { name: "Accept issue" }));

    const status = await screen.findByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("CR-1: accepted"));
    expect(status).toHaveFocus();
    expect(screen.queryByText("Pothole one")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    stubFetch(jsonResponse(TICKETS));
    const { container } = renderDashboard(ADMIN);
    await screen.findByRole("group", { name: "Work queues" });
    await expectNoAxeViolations(container);
  });
});
