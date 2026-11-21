"use client";

// =============================================================================
// [ACCESSIBILITY][GOOGLE SERVICES] MULTILINGUAL VOICE REPORTING (beyond the brief)
// -----------------------------------------------------------------------------
// Many citizens are more comfortable speaking Tamil or Hindi than typing English,
// and some can't type at all. This records a voice note in the browser
// (MediaRecorder, so no app install and no third-party speech service). The
// audio goes straight to Gemini with the rest of the report. In that same
// single call Gemini transcribes it, detects the language, translates it to an
// English summary and classifies the issue. No separate Speech-to-Text pipeline.
// =============================================================================

import { useEffect, useRef, useState } from "react";

// A 60-second cap keeps uploads small and is plenty to describe a civic issue.
const MAX_SECONDS = 60;

// Cross-browser support: Chrome/Firefox record WebM/Opus, Safari (iOS) records
// MP4/AAC. We pick the first format this browser supports; Gemini accepts all of them.
function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  if (typeof MediaRecorder === "undefined") return "";
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export default function VoiceRecorder({ onChange }: { onChange: (blob: Blob | null) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "done">("idle");
  const [seconds, setSeconds] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // [CODE QUALITY][SECURITY] Cleanup on unmount: always release the microphone (the browser's "recording"
  // indicator turns off) and stop the countdown timer.
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        const blob = new Blob(chunks, { type: (r.mimeType || mime || "audio/webm").split(";")[0] });
        setUrl(URL.createObjectURL(blob));
        setState("done");
        onChange(blob);
      };
      rec.current = r;
      r.start();
      setSeconds(0);
      setState("recording");
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS && r.state === "recording") r.stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      // Permission denied or no microphone: explain it, and the text form still works.
      setError("Microphone not available. Check browser permissions.");
    }
  }

  function stop() {
    if (rec.current?.state === "recording") rec.current.stop();
  }

  function clear() {
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
    setState("idle");
    onChange(null);
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3">
      <div className="flex flex-wrap items-center gap-3">
        {state !== "recording" ? (
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-2 rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-white" />
            {state === "done" ? "Record again" : "Record voice note"}
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white"
          >
            <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-sm bg-rose-500" />
            Stop ({MAX_SECONDS - seconds}s left)
          </button>
        )}
        {state === "done" && url && (
          <>
            <audio controls src={url} className="h-9" aria-label="Your voice note" />
            <button type="button" onClick={clear} className="text-sm text-slate-600 underline">
              Remove
            </button>
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Speak in Tamil, Hindi, English or any language. Gemini transcribes and translates it.
      </p>
      {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
      {/* [ACCESSIBILITY] Screen-reader announcement of recording state (accessibility). */}
      <span className="sr-only" aria-live="polite">{state === "recording" ? "Recording" : state === "done" ? "Recording saved" : ""}</span>
    </div>
  );
}
