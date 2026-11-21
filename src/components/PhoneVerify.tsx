"use client";

// =============================================================================
// [SECURITY][ACCESSIBILITY] PHONE VERIFICATION STEP (shown after "Submit report")
// -----------------------------------------------------------------------------
// Anti-spam accountability: a report is only accepted from an OTP-verified mobile number
// (server side: lib/otp.ts + api/tickets POST). For the citizen this is one quick step:
//   1. number (pre-filled on a device that has reported before, if they chose "remember")
//   2. "Send code" → 6-digit code → "Verify & submit"
// SMS is not connected yet, so the code is shown on screen in a clearly labelled demo note.
// [ACCESSIBILITY] Real modal dialog: role="dialog" + aria-modal, labelled, focus moves into
// it, Escape closes it, numeric keypad and SMS autofill (autocomplete="one-time-code") on
// phones, errors announced with role="alert".
// [SECURITY] The number is remembered ONLY in this browser's localStorage, and only if the
// citizen ticks the box. It is never shown to departments or the public.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const REMEMBER_KEY = "civicresolve.phone";
const input =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none";

export interface VerifiedPhone {
  phone: string;
  otp: string;
  otpChallenge: string;
}

interface Props {
  /** Submits the report with the verified phone (or null = send without verification, held for review).
   *  Resolves to an error message, or null on success. */
  onVerified: (v: VerifiedPhone | null) => Promise<string | null>;
  onCancel: () => void;
  busy: boolean;
}

export default function PhoneVerify({ onVerified, onCancel, busy }: Props) {
  const [phone, setPhone] = useState("");
  const [remember, setRemember] = useState(true);
  const [sent, setSent] = useState<{ challenge: string; phone: string; devCode?: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);

  // Pre-fill a remembered number, and move focus into the dialog.
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(REMEMBER_KEY); } catch {}
    // Reading browser storage once on open; it can't be read during server rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setPhone(saved);
    phoneRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  async function sendCode() {
    setError(null);
    setSending(true);
    try {
      const r = await fetch("/api/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await r.json();
      if (!r.ok) return setError(data.error ?? "Couldn't send the code.");
      setSent({ challenge: data.challenge, phone: data.phone, devCode: data.devCode });
      setOtp("");
      setTimeout(() => otpRef.current?.focus(), 0);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!sent) return sendCode();
    if (!/^\d{6}$/.test(otp)) return setError("Enter the 6-digit code.");
    setError(null);
    const err = await onVerified({ phone: sent.phone, otp, otpChallenge: sent.challenge });
    if (err) return setError(err);
    try {
      if (remember) localStorage.setItem(REMEMBER_KEY, phone);
      else localStorage.removeItem(REMEMBER_KEY);
    } catch {}
  }

  // Rendered into <body> via a portal so no ancestor stacking context (or the map's controls)
  // can ever draw on top of the dialog. This component only mounts after a click, so
  // document is always available here.
  return createPortal(
    <div className="fixed inset-0 z-[5000] flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="verify-title"
        aria-describedby="verify-why"
        onSubmit={verify}
        noValidate
        className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl"
      >
        <div>
          <h2 id="verify-title" className="text-lg font-semibold">Verify your phone to submit</h2>
          <p id="verify-why" className="mt-1 text-sm text-slate-600">
            This keeps fake reports out. Your number is private: departments and the public never see it.
            It is kept only so misuse can be traced.
          </p>
        </div>

        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium">Mobile number</label>
          <div className="flex gap-2">
            <span className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700" aria-hidden="true">+91</span>
            <input
              id="phone" ref={phoneRef} type="tel" inputMode="numeric" autoComplete="tel-national"
              className={input} value={phone} maxLength={14} placeholder="98765 43210"
              onChange={(e) => { setPhone(e.target.value); setSent(null); }}
              disabled={busy}
            />
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember this number on this device
          </label>
        </div>

        {sent && (
          <div>
            <label htmlFor="otp" className="mb-1 block text-sm font-medium">6-digit code sent to {sent.phone}</label>
            <input
              id="otp" ref={otpRef} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}"
              className={`${input} tracking-[0.4em]`} value={otp} maxLength={6}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              disabled={busy} aria-describedby={sent.devCode ? "otp-stub" : undefined}
            />
            {/* SMS STUB: shown only while no SMS gateway is configured (server sends devCode only then). */}
            {sent.devCode && (
              <p id="otp-stub" className="mt-1 text-xs text-slate-500">
                Demo: SMS isn&apos;t connected yet, so use this code: <strong className="font-mono">{sent.devCode}</strong>.
                Once SMS is enabled, the code will arrive by text message instead.
              </p>
            )}
            <button type="button" onClick={sendCode} disabled={sending || busy}
              className="mt-1 text-xs font-medium text-blue-700 underline disabled:opacity-50">
              Send a new code
            </button>
          </div>
        )}

        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy || sending}
            className="flex-1 rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            {busy ? "Gemini is analysing your report…" : sending ? "Sending…" : sent ? "Verify & submit report" : "Send code"}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}
            className="rounded-md px-4 py-2 text-sm font-medium ring-1 ring-slate-300 disabled:opacity-50">
            Back
          </button>
        </div>

        {/* Second bucket: a genuine citizen without a phone (or unwilling to share it) is still heard.
            The report is saved but held for a city officer's review before reaching a department. */}
        <div className="border-t border-slate-200 pt-3 text-xs text-slate-600">
          No phone, or prefer not to share it?{" "}
          <button type="button" disabled={busy || sending}
            onClick={async () => { setError(null); const err = await onVerified(null); if (err) setError(err); }}
            className="font-medium text-blue-700 underline disabled:opacity-50">
            Send without verifying
          </button>
          . It will be saved, but a city officer reviews it first, so it may take longer to reach the department.
        </div>
      </form>
    </div>,
    document.body,
  );
}
