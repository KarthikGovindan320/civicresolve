// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/I18nProvider";
import ReportForm from "@/app/ReportForm";
import { downscale } from "@/lib/client/image";
import { createTranslator } from "@/lib/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/image", () => ({ downscale: vi.fn() }));
// Leaflet needs a real browser layout engine; the photo behaviour does not depend on the map.
vi.mock("@/components/Map", () => ({ default: () => <div data-testid="map" /> }));
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
