// @vitest-environment jsdom
// The staff ticket card and its action forms, driven through the card as staff use it: each
// action must send the right PATCH (or POST) body and show the server's answer.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TicketCard from "@/app/staff/TicketCard";
import type { StaffTicket } from "@/app/staff/types";
import { FixedLanguage } from "@/components/I18nProvider";
import { downscaleSelected } from "@/lib/client/image";
import { jsonResponse, makeTicket, sentJson, stubFetch } from "./setup";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/image", () => ({ downscaleSelected: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

function renderCard(ticket: StaffTicket, { isAdmin = false } = {}) {
  const onUpdated = vi.fn();
  render(
    <FixedLanguage lang="en">
      <ul>
        <TicketCard ticket={ticket} staffKey="key" isAdmin={isAdmin} onUpdated={onUpdated} />
      </ul>
    </FixedLanguage>,
  );
  // The card's actions sit inside a native <details>; open it as a staff member would.
  fireEvent.click(screen.getByText(ticket.title));
  return { user: userEvent.setup(), onUpdated };
}

describe("accepting a reported ticket", () => {
  it("sends the acknowledge action with the promised date and note, and reports success", async () => {
    const fetchMock = stubFetch(jsonResponse(makeTicket({ status: "In Progress" })));
    const { user, onUpdated } = renderCard(makeTicket());
    fireEvent.change(screen.getByLabelText("Promise a fix by"), { target: { value: "2026-12-01" } });
    await user.type(screen.getByLabelText("Note to citizen (optional)"), "On it");
    await user.click(screen.getByRole("button", { name: "Accept issue" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.anything(), "CR-1001: accepted"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/CR-1001");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH");
    expect(sentJson(fetchMock)).toEqual({ action: "acknowledge", expectedFixDate: "2026-12-01", note: "On it" });
  });

  it("is not offered while a report waits for the admin's review", () => {
    renderCard(makeTicket({ verification: "unverified" }));
    expect(screen.queryByRole("button", { name: "Accept issue" })).not.toBeInTheDocument();
  });
});

describe("transferring a ticket", () => {
  it("offers only the other departments and sends the transfer with its reason", async () => {
    const fetchMock = stubFetch(jsonResponse(makeTicket({ department: "Sanitation" })));
    const { user, onUpdated } = renderCard(makeTicket());
    const select = screen.getByLabelText("Not ours? Transfer to");
    expect(within(select).queryByRole("option", { name: "Public Works (Roads)" })).not.toBeInTheDocument();

    await user.selectOptions(select, "Sanitation");
    await user.type(screen.getByLabelText("Reason"), "Garbage, not road");
    await user.click(screen.getByRole("button", { name: "Transfer" }));

    await waitFor(() =>
      expect(onUpdated).toHaveBeenCalledWith(expect.anything(), "CR-1001: transferred to Sanitation"),
    );
    expect(sentJson(fetchMock)).toEqual({ action: "transfer", department: "Sanitation", note: "Garbage, not road" });
  });
});

describe("marking a ticket fixed", () => {
  const inProgress = makeTicket({ status: "In Progress" });

  it("requires an after photo from a department", () => {
    renderCard(inProgress);
    expect(screen.getByLabelText("After photo (required)")).toBeRequired();
  });

  it("lets the admin close without a photo and posts the note as form data", async () => {
    const fetchMock = stubFetch(jsonResponse(makeTicket({ status: "Resolved" })));
    const { user, onUpdated } = renderCard(inProgress, { isAdmin: true });
    expect(screen.getByLabelText("After photo (optional for admin)")).not.toBeRequired();

    await user.type(screen.getByLabelText("What was done?"), "Filled and rolled");
    await user.click(screen.getByRole("button", { name: "Mark fixed" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/tickets/CR-1001/resolve");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("note")).toBe("Filled and rolled");
    expect((init?.body as FormData).get("photo")).toBeNull();
  });

  it("attaches the downscaled after photo", async () => {
    vi.mocked(downscaleSelected).mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
    const fetchMock = stubFetch(jsonResponse(makeTicket({ status: "Resolved" })));
    const { user } = renderCard(inProgress);
    await user.upload(
      screen.getByLabelText("After photo (required)"),
      new File(["x"], "after.jpg", { type: "image/jpeg" }),
    );
    await user.type(screen.getByLabelText("What was done?"), "Fixed");
    // jsdom never counts an uploaded file as satisfying `required`, so submit the form directly.
    fireEvent.submit(screen.getByRole("button", { name: "Mark fixed" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0][1]?.body as FormData).get("photo")).toBeInstanceOf(Blob);
  });

  it("shows the server's rejection and re-enables the form", async () => {
    stubFetch(jsonResponse({ error: "The after photo does not show the fix." }, 422));
    const { user, onUpdated } = renderCard(inProgress, { isAdmin: true });
    await user.type(screen.getByLabelText("What was done?"), "Fixed");
    await user.click(screen.getByRole("button", { name: "Mark fixed" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The after photo does not show the fix.");
    expect(screen.getByRole("button", { name: "Mark fixed" })).toBeEnabled();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("shows the resolution instead of the forms once resolved", () => {
    renderCard(
      makeTicket({
        status: "Resolved",
        citizenConfirmation: "pending",
        resolution: {
          note: "Patched",
          hasPhoto: false,
          aiVerdict: "fixed",
          aiReason: "Looks good",
          by: "PWD",
          at: inProgress.createdAt,
        },
      }),
    );
    expect(screen.getByText(/Patched/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Transfer" })).not.toBeInTheDocument();
  });
});

describe("reviewing an unverified report", () => {
  const held = makeTicket({ verification: "unverified" });

  it.each([
    ["Approve", "approve", "approved"],
    ["Reject", "reject", "rejected"],
  ])("%s sends the review decision with the shared note", async (button, decision, confirmation) => {
    const fetchMock = stubFetch(jsonResponse(makeTicket()));
    const { user, onUpdated } = renderCard(held, { isAdmin: true });
    await user.type(screen.getByLabelText("Note (optional, shown to the citizen)"), "Checked");
    await user.click(screen.getByRole("button", { name: button }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.anything(), `CR-1001: ${confirmation}`));
    expect(sentJson(fetchMock)).toEqual({ action: "review", decision, note: "Checked" });
  });

  it("is shown only to the admin", () => {
    renderCard(held);
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});

describe("admin overrides", () => {
  it.each([
    ["Status", "Resolved", { status: "Resolved" }],
    ["Category", "Garbage", { category: "Garbage" }],
    ["Department", "Sanitation", { department: "Sanitation" }],
    ["Priority", "Critical", { priority: "Critical" }],
  ])("changing %s saves it at once as an update action", async (label, value, field) => {
    const fetchMock = stubFetch(jsonResponse(makeTicket()));
    const { user } = renderCard(makeTicket(), { isAdmin: true });
    await user.selectOptions(screen.getByLabelText(label), value);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentJson(fetchMock)).toEqual({ action: "update", note: "", ...field });
  });

  it("explains when the effective priority is above the admin's base priority", () => {
    renderCard(makeTicket({ priority: "Critical", basePriority: "High" }), { isAdmin: true });
    expect(screen.getByRole("note")).toHaveTextContent("Effective priority is Critical");
    expect(screen.getByLabelText("Priority")).toHaveValue("High");
  });

  it("are hidden from departments", () => {
    renderCard(makeTicket());
    expect(screen.queryByRole("group", { name: "Admin overrides" })).not.toBeInTheDocument();
  });
});

describe("public timeline notes", () => {
  it("clears the note only after the server saved it", async () => {
    const fetchMock = stubFetch(jsonResponse(makeTicket()));
    const { user } = renderCard(makeTicket());
    const note = screen.getByLabelText("Public timeline note for CR-1001");
    await user.type(note, "Crew booked");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => expect(note).toHaveValue(""));
    expect(sentJson(fetchMock)).toEqual({ action: "note", note: "Crew booked" });
  });

  it("keeps the note and shows the error when saving fails", async () => {
    stubFetch(new TypeError("offline"));
    const { user } = renderCard(makeTicket());
    const note = screen.getByLabelText("Public timeline note for CR-1001");
    await user.type(note, "Crew booked");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Network error. Please try again.");
    expect(note).toHaveValue("Crew booked");
    expect(screen.getByRole("button", { name: "Add note" })).toBeEnabled();
  });

  it("ignores an empty note", async () => {
    const fetchMock = stubFetch(jsonResponse(makeTicket()));
    const { user } = renderCard(makeTicket());
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a reopened ticket", () => {
  it("shows the citizen's new photo, versioned by the update time", () => {
    renderCard(
      makeTicket({ status: "In Progress", citizenConfirmation: "reopened", hasReopenPhoto: true, reopenCount: 1 }),
    );
    const photo = screen.getByAltText("New photo from the citizen after reopening CR-1001");
    expect(photo.getAttribute("src")).toBe("/api/tickets/CR-1001/image?v=reopen&t=2026-11-01T06%3A00%3A00.000Z");
    expect(screen.getByText("Reopened ×1")).toBeVisible();
  });
});

describe("messages from staff", () => {
  it("sends the message and hands the updated ticket back", async () => {
    const fetchMock = stubFetch(jsonResponse(makeTicket()));
    const { user, onUpdated } = renderCard(makeTicket());
    await user.type(screen.getByLabelText("Write a message"), "We will fix it this week");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.anything(), "CR-1001: message sent"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/CR-1001/messages");
    expect(sentJson(fetchMock)).toEqual({ text: "We will fix it this week" });
  });

  it("reports a failed send without throwing", async () => {
    stubFetch(new TypeError("offline"));
    const { user } = renderCard(makeTicket());
    await user.type(screen.getByLabelText("Write a message"), "Hello");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error. Please try again.");
  });
});
