// @vitest-environment jsdom
// Voice notes: recording with the browser's MediaRecorder (faked here, as jsdom has none),
// the microphone being refused, and the automatic stop at the time limit.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/I18nProvider";
import VoiceRecorder from "@/components/VoiceRecorder";
import { createTranslator } from "@/lib/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const t = createTranslator("en");
const stopTrack = vi.fn();
const stream = { getTracks: () => [{ stop: stopTrack }] };

/** A minimal MediaRecorder: start() begins recording; stop() delivers one chunk and fires onstop. */
class FakeMediaRecorder {
  static isTypeSupported = (type: string) => type === "audio/webm";
  static latest: FakeMediaRecorder | null = null;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  stream = stream;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    FakeMediaRecorder.latest = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["sound"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

function setup(getUserMedia = vi.fn().mockResolvedValue(stream)) {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  const onChange = vi.fn();
  render(
    <I18nProvider initialLang="en">
      <VoiceRecorder onChange={onChange} />
    </I18nProvider>,
  );
  return { onChange };
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:voice");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  stopTrack.mockClear();
});

describe("VoiceRecorder", () => {
  it("records, stops, offers playback and hands the recording to the form", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole("button", { name: t("voice.record") }));
    expect(screen.getByText(t("voice.recording"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("voice.stop", { seconds: 60 }) }));
    expect(onChange).toHaveBeenCalledWith(expect.any(Blob));
    expect(onChange.mock.calls[0][0].type).toBe("audio/webm");
    expect(stopTrack).toHaveBeenCalled(); // the microphone is released
    expect(screen.getByLabelText(t("voice.playback"))).toHaveAttribute("src", "blob:voice");
    expect(screen.getByRole("button", { name: t("voice.recordAgain") })).toBeVisible();
  });

  it("removes the recording and its playback URL", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole("button", { name: t("voice.record") }));
    await user.click(screen.getByRole("button", { name: t("voice.stop", { seconds: 60 }) }));
    await user.click(screen.getByRole("button", { name: t("voice.remove") }));

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:voice");
    expect(screen.queryByLabelText(t("voice.playback"))).not.toBeInTheDocument();
  });

  it("explains when the microphone is refused", async () => {
    const user = userEvent.setup();
    setup(vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")));
    await user.click(screen.getByRole("button", { name: t("voice.record") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("voice.micUnavailable"));
  });

  it("counts down and stops by itself at the time limit", async () => {
    vi.useFakeTimers();
    const { onChange } = setup();
    await act(async () => screen.getByRole("button", { name: t("voice.record") }).click());
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("button", { name: t("voice.stop", { seconds: 50 }) })).toBeVisible();

    act(() => vi.advanceTimersByTime(50_000));
    expect(FakeMediaRecorder.latest?.state).toBe("inactive");
    expect(onChange).toHaveBeenCalledWith(expect.any(Blob));
  });
});
