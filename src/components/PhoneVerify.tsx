"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiRequest, failureMessages, settle } from "@/lib/client/api";
import { OTP_DIGITS } from "@/lib/constants";
import { useT } from "./I18nProvider";
import LabelledField from "./LabelledField";
import { fieldClass } from "./ui";
import { useModalFocusTrap } from "./useModalFocusTrap";

const REMEMBERED_PHONE_STORAGE = "civicresolve.phone";
const OTP_PATTERN = new RegExp(`^\\d{${OTP_DIGITS}}$`);
const ERROR_ID = "verify-error";

function readRememberedPhone(): string {
  try {
    return localStorage.getItem(REMEMBERED_PHONE_STORAGE) ?? "";
  } catch {
    return "";
  }
}

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
  // This dialog only mounts after a click, in the browser, so storage can be read while initialising.
  const [phone, setPhone] = useState(readRememberedPhone);
  const [remember, setRemember] = useState(true);
  const [sent, setSent] = useState<OtpChallenge | null>(null);
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  // The field an error is about is marked invalid and described by the message.
  const [error, setError] = useState<{ message: string; field?: "phone" | "otp" } | null>(null);

  const otpRef = useRef<HTMLInputElement>(null);
  const dialogRef = useModalFocusTrap<HTMLFormElement>(() => {
    if (!busy) onCancel();
  });

  const phoneInvalid = error?.field === "phone";

  async function sendCode() {
    setError(null);
    setSending(true);
    const outcome = await settle(
      apiRequest<OtpChallenge>("/api/otp", { method: "POST", json: { phone } }),
      failureMessages(t, "verify.error.sendFailed"),
    );
    setSending(false);
    if (!outcome.ok) return setError({ message: outcome.error, field: "phone" });
    const { challenge, phone: normalisedPhone, devCode } = outcome.data;
    setSent({ challenge, phone: normalisedPhone, devCode });
    setOtp("");
    // The code field only exists after this render, so focus it on the next tick.
    setTimeout(() => otpRef.current?.focus(), 0);
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!sent) return sendCode();
    if (!OTP_PATTERN.test(otp))
      return setError({ message: t("verify.error.codeFormat", { digits: OTP_DIGITS }), field: "otp" });
    setError(null);
    const submitError = await onVerified({ phone: sent.phone, otp, otpChallenge: sent.challenge });
    if (submitError) return setError({ message: submitError, field: "otp" });
    try {
      if (remember) localStorage.setItem(REMEMBERED_PHONE_STORAGE, phone);
      else localStorage.removeItem(REMEMBERED_PHONE_STORAGE);
    } catch {}
  }

  async function submitUnverified() {
    setError(null);
    const submitError = await onVerified(null);
    if (submitError) setError({ message: submitError });
  }

  /** The main button's label: what pressing it will do, or what is happening now. */
  function submitLabel() {
    if (busy) return t("report.analysing");
    if (sending) return t("common.sending");
    return sent ? t("verify.submit") : t("verify.sendCode");
  }

  // Rendered into <body> via a portal so no ancestor stacking context (or the map's controls)
  // can ever draw on top of the dialog. This component only mounts after a click, so
  // document is always available here.
  return createPortal(
    <div className="fixed inset-0 z-[5000] flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <form
        ref={dialogRef}
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
              aria-invalid={phoneInvalid || undefined}
              aria-describedby={phoneInvalid ? ERROR_ID : undefined}
            />
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            {t("verify.remember")}
          </label>
        </LabelledField>

        {sent && (
          <CodeField
            challenge={sent}
            inputRef={otpRef}
            code={otp}
            onCodeChange={setOtp}
            invalid={error?.field === "otp"}
            busy={busy}
            onNewCode={sendCode}
            newCodeDisabled={sending || busy}
          />
        )}

        {error && (
          <p id={ERROR_ID} role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error.message}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || sending}
            className="flex-1 rounded-md bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {submitLabel()}
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

/** The one-time-code field, with the demo note (while SMS is not connected) and "Send a new code". */
function CodeField({
  challenge,
  inputRef,
  code,
  onCodeChange,
  invalid,
  busy,
  onNewCode,
  newCodeDisabled,
}: {
  challenge: OtpChallenge;
  inputRef: React.Ref<HTMLInputElement>;
  code: string;
  onCodeChange: (code: string) => void;
  /** Whether the dialog's error is about the code, which then describes the field. */
  invalid: boolean;
  busy: boolean;
  onNewCode: () => void;
  newCodeDisabled: boolean;
}) {
  const t = useT();
  // The field can be described by both the demo note and the error.
  const description = [challenge.devCode && "otp-stub", invalid && ERROR_ID].filter(Boolean).join(" ");
  return (
    <LabelledField id="otp" label={t("verify.codeLabel", { phone: challenge.phone, digits: OTP_DIGITS })}>
      <input
        id="otp"
        ref={inputRef}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern={`\\d{${OTP_DIGITS}}`}
        className={`${fieldClass} tracking-[0.4em]`}
        value={code}
        maxLength={OTP_DIGITS}
        onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, ""))}
        disabled={busy}
        aria-invalid={invalid || undefined}
        aria-describedby={description || undefined}
      />
      {/* Demo note: shown only while no SMS gateway is configured (the server sends devCode only then). */}
      {challenge.devCode && (
        <p id="otp-stub" className="mt-1 text-xs text-slate-600">
          {t("verify.demoBefore")} <strong className="font-mono">{challenge.devCode}</strong>. {t("verify.demoAfter")}
        </p>
      )}
      <button
        type="button"
        onClick={onNewCode}
        disabled={newCodeDisabled}
        className="mt-1 inline-flex min-h-6 items-center text-xs font-medium text-blue-700 underline disabled:opacity-50"
      >
        {t("verify.newCode")}
      </button>
    </LabelledField>
  );
}
