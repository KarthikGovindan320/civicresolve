"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "./I18nProvider";

// A 60-second cap keeps uploads small and is plenty to describe a civic issue.
const MAX_SECONDS = 60;

// Cross-browser support: Chrome/Firefox record WebM/Opus, Safari (iOS) records
// MP4/AAC. We pick the first format this browser supports; Gemini accepts all of them.
function supportedMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

/**
 * Records a voice note in the browser. Many citizens are more comfortable
 * speaking Tamil or Hindi than typing English, and some can't type at all.
 * Recording uses MediaRecorder, so there is no app install and no third-party
 * speech service: the audio goes to Gemini with the rest of the report, and
 * in that same call Gemini transcribes it, detects the language, translates
 * it to an English summary and classifies the issue.
 */
export default function VoiceRecorder({ onChange }: { onChange: (recording: Blob | null) => void }) {
  const t = useT();
  const [phase, setPhase] = useState<"idle" | "recording" | "done">("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // On unmount, always release the microphone (so the browser's "recording"
  // indicator turns off) and stop the countdown timer.
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        const recording = new Blob(chunks, { type: (recorder.mimeType || mimeType || "audio/webm").split(";")[0] });
        setPlaybackUrl(URL.createObjectURL(recording));
        setPhase("done");
        onChange(recording);
      };
      recorderRef.current = recorder;
      recorder.start();
      setElapsedSeconds(0);
      setPhase("recording");
      timerRef.current = setInterval(() => {
        setElapsedSeconds((elapsed) => {
          if (elapsed + 1 >= MAX_SECONDS && recorder.state === "recording") recorder.stop();
          return elapsed + 1;
        });
      }, 1000);
    } catch {
      // Permission denied or no microphone: explain it, and the text form still works.
      setError(t("voice.micUnavailable"));
    }
  }

  function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function clear() {
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    setPlaybackUrl(null);
    setPhase("idle");
    onChange(null);
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3">
      <div className="flex flex-wrap items-center gap-3">
        {phase !== "recording" ? (
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-2 rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-white" />
            {phase === "done" ? t("voice.recordAgain") : t("voice.record")}
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white"
          >
            <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-sm bg-rose-500" />
            {t("voice.stop", { seconds: MAX_SECONDS - elapsedSeconds })}
          </button>
        )}
        {phase === "done" && playbackUrl && (
          <>
            <audio controls src={playbackUrl} className="h-9" aria-label={t("voice.playback")} />
            <button type="button" onClick={clear} className="text-sm text-slate-600 underline">
              {t("voice.remove")}
            </button>
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">{t("voice.hint")}</p>
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
      {/* Announces the recording state to screen readers. */}
      <span className="sr-only" aria-live="polite">
        {phase === "recording" ? t("voice.recording") : phase === "done" ? t("voice.saved") : ""}
      </span>
    </div>
  );
}
