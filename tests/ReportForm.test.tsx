// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OTP_DIGITS } from "@/lib/constants";
import { I18nProvider } from "@/components/I18nProvider";
import ReportForm from "@/app/ReportForm";
import { downscale } from "@/lib/client/image";
import { createTranslator } from "@/lib/i18n";
import { expectNoAxeViolations, jsonResponse, makeTicket, stubFetch } from "./setup";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/image", () => ({ downscale: vi.fn() }));
// Leaflet needs a real browser layout engine; the photo behaviour does not depend on the map.
vi.mock("@/components/LazyMap", () => ({
  default: ({ label, describedBy }: { label: string; describedBy?: string }) => (
    <div role="region" aria-label={label} aria-describedby={describedBy} />
  ),
}));
vi.mock("@/components/VoiceRecorder", () => ({ default: () => null }));

const t = createTranslator("en");
const downscaleMock = vi.mocked(downscale);

function choose(file: File) {
  fireEvent.change(screen.getByLabelText(t("report.photo")), { target: { files: [file] } });
}

describe("ReportForm photo handling", () => {
  let counter = 0;
  const revoke = vi.fn();

  beforeEach(() => {
    counter = 0;
    URL.createObjectURL = vi.fn(() => `blob:preview-${++counter}`);
    URL.revokeObjectURL = revoke;
    render(
      <I18nProvider initialLang="en">
        <ReportForm />
      </I18nProvider>,
    );
  });
  afterEach(() => {
    revoke.mockClear();
    downscaleMock.mockReset();
  });

  it("previews a chosen photo and releases the old preview only after the new one decodes", async () => {
    downscaleMock.mockResolvedValue(new Blob(["a"]));
    choose(new File(["x"], "a.jpg", { type: "image/jpeg" }));
    const preview = await screen.findByAltText(t("report.photoPreviewAlt"));
    expect(preview).toHaveAttribute("src", "blob:preview-1");

    downscaleMock.mockResolvedValue(new Blob(["b"]));
    choose(new File(["y"], "b.jpg", { type: "image/jpeg" }));
    await waitFor(() =>
      expect(screen.getByAltText(t("report.photoPreviewAlt"))).toHaveAttribute("src", "blob:preview-2"),
    );
    expect(revoke).toHaveBeenCalledWith("blob:preview-1");
  });

  it("keeps the previous preview and shows an error when a new photo cannot be read", async () => {
    downscaleMock.mockResolvedValueOnce(new Blob(["a"]));
    choose(new File(["x"], "a.jpg", { type: "image/jpeg" }));
    await screen.findByAltText(t("report.photoPreviewAlt"));

    downscaleMock.mockRejectedValueOnce(new Error("decode"));
    choose(new File(["bad"], "b.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText(t("report.error.imageUnreadable"))).toBeInTheDocument();
    expect(screen.getByAltText(t("report.photoPreviewAlt"))).toHaveAttribute("src", "blob:preview-1");
    expect(revoke).not.toHaveBeenCalled();
  });

  it("revokes the preview URL when the form unmounts", async () => {
    downscaleMock.mockResolvedValue(new Blob(["a"]));
    choose(new File(["x"], "a.jpg", { type: "image/jpeg" }));
    await screen.findByAltText(t("report.photoPreviewAlt"));
    cleanup(); // unmounts the form so React runs its cleanup effects
    expect(revoke).toHaveBeenCalledWith("blob:preview-1");
  });
});

describe("ReportForm validation", () => {
  function renderForm() {
    const view = render(
      <I18nProvider initialLang="en">
        <ReportForm />
      </I18nProvider>,
    );
    return { ...view, user: userEvent.setup() };
  }

  it("asks for a location first, describing the map with the error", async () => {
    const { user } = renderForm();
    await user.click(screen.getByRole("button", { name: t("report.submit") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("report.error.needLocation"));
    expect(screen.getByRole("region", { name: t("map.pickerLabel") })).toHaveAccessibleDescription(
      expect.stringContaining(t("report.error.needLocation")),
    );
  });

  it("marks the title and description invalid when both are empty", async () => {
    const { user } = renderForm();
    await user.click(screen.getByRole("button", { name: t("sample.button") }));
    await user.clear(screen.getByLabelText(t("report.title")));
    await user.clear(screen.getByLabelText(t("report.description")));
    await user.click(screen.getByRole("button", { name: t("report.submit") }));

    const message = t("report.error.needContent");
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    for (const label of [t("report.title"), t("report.description")]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(message);
    }
  });

  it("opens phone verification once the report is complete", async () => {
    const { user } = renderForm();
    await user.click(screen.getByRole("button", { name: t("sample.button") }));
    await user.click(screen.getByRole("button", { name: t("report.submit") }));
    expect(await screen.findByRole("dialog", { name: t("verify.title") })).toBeVisible();
    expect(screen.getByLabelText(t("report.title"))).not.toHaveAttribute("aria-invalid");
  });

  it("has no axe violations", async () => {
    const { container } = renderForm();
    await expectNoAxeViolations(container);
  });

  it("sends a verified report and shows what the AI understood, with the private link", async () => {
    const ticket = makeTicket({ id: "CR-2001", englishSummary: "Pothole on the main road" });
    const fetchMock = stubFetch(
      jsonResponse({ challenge: "c1", phone: "+919876543210", devCode: "123456" }),
      jsonResponse({
        merged: true,
        reason: "Same spot",
        ticket: { ...ticket, reporterCount: 2 },
        aiSource: "fallback",
        privateLink: "https://x/track/CR-2001?k=t",
      }),
    );
    const { user } = renderForm();
    await user.click(screen.getByRole("button", { name: t("sample.button") }));
    await user.click(screen.getByRole("button", { name: t("report.submit") }));
    await user.type(screen.getByLabelText(t("verify.phone")), "9876543210");
    await user.click(screen.getByRole("button", { name: t("verify.sendCode") }));
    const code = await screen.findByLabelText(t("verify.codeLabel", { phone: "+919876543210", digits: OTP_DIGITS }));
    await user.type(code, "123456");
    await user.click(screen.getByRole("button", { name: t("verify.submit") }));

    expect(await screen.findByRole("heading", { name: `${t("result.ticket")} CR-2001` })).toBeVisible();
    expect(screen.getByText(t("result.merged"))).toBeVisible();
    expect(screen.getByText("Same spot")).toHaveAttribute("lang", "en");
    expect(screen.getByText(t("result.fallback"))).toBeVisible();
    expect(screen.getByLabelText(t("result.linkLabel"))).toHaveValue("https://x/track/CR-2001?k=t");
    const form = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(form.get("otp")).toBe("123456");
    expect(form.get("otpChallenge")).toBe("c1");
    vi.unstubAllGlobals();
  });

  it("keeps the dialog open with the server's message when the report is refused", async () => {
    stubFetch(jsonResponse({ error: "Too many reports. Try again later." }, 429));
    const { user } = renderForm();
    await user.click(screen.getByRole("button", { name: t("sample.button") }));
    await user.click(screen.getByRole("button", { name: t("report.submit") }));
    await user.click(screen.getByRole("button", { name: t("verify.sendUnverified") }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many reports. Try again later.");
    expect(screen.getByRole("dialog")).toBeVisible();
    vi.unstubAllGlobals();
  });

  it("pins the citizen's GPS position, or explains when it is unavailable", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback, failure: PositionErrorCallback) => {
      if (getCurrentPosition.mock.calls.length === 1)
        success({ coords: { latitude: 12.9, longitude: 79.1 } } as GeolocationPosition);
      else failure({} as GeolocationPositionError);
    });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
    const { user } = renderForm();
    await user.click(screen.getByRole("button", { name: t("report.useMyLocation") }));
    expect(screen.getByText(t("report.pinnedAt", { lat: "12.90000", lng: "79.10000" }))).toBeVisible();

    await user.click(screen.getByRole("button", { name: t("report.useMyLocation") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("report.error.locationFailed"));
  });
});
