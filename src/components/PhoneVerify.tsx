"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiRequest } from "@/lib/client/api";
import { useT } from "./I18nProvider";
import LabelledField from "./LabelledField";
import { fieldClass } from "./ui";

const REMEMBERED_PHONE_STORAGE = "civicresolve.phone";
const OTP_PATTERN = /^\d{6}$/;

/** The server's answer to a code request. `devCode` is present only while no SMS gateway is configured. */
interface OtpChallenge {
  challenge: string;
  phone: string;
  devCode?: string;
}

export interface VerifiedPhone {
  phone: string;
  otp: string;
  otpChallenge: string;
}

interface Props {
  /** Submits the report with the verified phone (or null = send without verification, held for review).
   *  Resolves to an error message, or null on success. */
  onVerified: (verifiedPhone: VerifiedPhone | null) => Promise<string | null>;
  onCancel: () => void;
  busy: boolean;
}

/**
 * Phone verification step, shown as a dialog after "Submit report". A report
 * is accepted directly only from a mobile number verified by a one-time code,
 * which keeps spam out. For the citizen this is one quick step: enter the
 * number (pre-filled if they chose "remember" before), request the code,
 * type it in. SMS is not connected yet, so the code is shown on screen in a
 * clearly labelled demo note.
 *
 * It is a real modal dialog: labelled, focus moves into it, Escape closes it,
 * phones show the numeric keypad and offer SMS autofill, and errors are
 * announced. The number is remembered only in this browser's localStorage,
 * and only if the citizen ticks the box; it is never shown to departments or
 * the public.
 */
export default function PhoneVerify({ onVerified, onCancel, busy }: Props) {
  const t = useT();
  const [phone, setPhone] = useState("");
  const [remember, setRemember] = useState(true);
  const [sent, setSent] = useState<OtpChallenge | null>(null);
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);

  // Pre-fill a remembered number, and move focus into the dialog.
  useEffect(() => {
    let rememberedPhone: string | null = null;
    try {
      rememberedPhone = localStorage.getItem(REMEMBERED_PHONE_STORAGE);
    } catch {}
    // Reading browser storage once on open; it can't be read during server rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (rememberedPhone) setPhone(rememberedPhone);
    phoneRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);

  async function sendCode() {
    setError(null);
    setSending(true);
    try {
      const result = await apiRequest<OtpChallenge>("/api/otp", { method: "POST", json: { phone } });
      if (!result.ok) return setError(result.error ?? t("verify.error.sendFailed"));
      const { challenge, phone: normalisedPhone, devCode } = result.data;
      setSent({ challenge, phone: normalisedPhone, devCode });
      setOtp("");
      // The code field only exists after this render, so focus it on the next tick.
      setTimeout(() => otpRef.current?.focus(), 0);
    } catch {
      setError(t("common.error.network"));
    } finally {
      setSending(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!sent) return sendCode();
    if (!OTP_PATTERN.test(otp)) return setError(t("verify.error.codeFormat"));
    setError(null);
    const submitError = await onVerified({ phone: sent.phone, otp, otpChallenge: sent.challenge });
    if (submitError) return setError(submitError);
    try {
      if (remember) localStorage.setItem(REMEMBERED_PHONE_STORAGE, phone);
      else localStorage.removeItem(REMEMBERED_PHONE_STORAGE);
    } catch {}
  }

  async function submitUnverified() {
    setError(null);
    const submitError = await onVerified(null);
    if (submitError) setError(submitError);
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
        className="max-h-full w-full max-w-md space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-xl ring-1 ring-slate-300"
      >
        <div>
          <h2 id="verify-title" className="text-lg font-semibold">
            {t("verify.title")}
          </h2>
          <p id="verify-why" className="mt-1 text-sm text-slate-600">
            {t("verify.why")}
          </p>
        </div>

        <LabelledField id="phone" label={t("verify.phone")}>
          <div className="flex gap-2">
            <span className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700" aria-hidden="true">
              +91
            </span>
            <input
              id="phone"
              ref={phoneRef}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              className={fieldClass}
              value={phone}
              maxLength={14}
              placeholder="98765 43210"
              onChange={(event) => {
                setPhone(event.target.value);
                setSent(null);
              }}
              disabled={busy}
            />
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            {t("verify.remember")}
          </label>
        </LabelledField>

        {sent && (
          <LabelledField id="otp" label={t("verify.codeLabel", { phone: sent.phone })}>
            <input
              id="otp"
              ref={otpRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              className={`${fieldClass} tracking-[0.4em]`}
              value={otp}
              maxLength={6}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
              disabled={busy}
              aria-describedby={sent.devCode ? "otp-stub" : undefined}
            />
            {/* Demo note: shown only while no SMS gateway is configured (the server sends devCode only then). */}
            {sent.devCode && (
              <p id="otp-stub" className="mt-1 text-xs text-slate-500">
                {t("verify.demoBefore")} <strong className="font-mono">{sent.devCode}</strong>. {t("verify.demoAfter")}
              </p>
            )}
            <button
              type="button"
              onClick={sendCode}
              disabled={sending || busy}
              className="mt-1 text-xs font-medium text-blue-700 underline disabled:opacity-50"
            >
              {t("verify.newCode")}
            </button>
          </LabelledField>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || sending}
            className="flex-1 rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy
              ? t("report.analysing")
              : sending
                ? t("common.sending")
                : sent
                  ? t("verify.submit")
                  : t("verify.sendCode")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-4 py-2 text-sm font-medium ring-1 ring-slate-300 disabled:opacity-50"
          >
            {t("verify.back")}
          </button>
        </div>

        {/* A genuine citizen without a phone (or unwilling to share it) is still heard.
            The report is saved but held for a city officer's review before reaching a department. */}
        <div className="border-t border-slate-200 pt-3 text-xs text-slate-600">
          {t("verify.noPhone")}{" "}
          <button
            type="button"
            disabled={busy || sending}
            onClick={submitUnverified}
            className="font-medium text-blue-700 underline disabled:opacity-50"
          >
            {t("verify.sendUnverified")}
          </button>
          <span className="mt-1 block">{t("verify.unverifiedNote")}</span>
        </div>
      </form>
    </div>,
    document.body,
  );
}
