"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { VerifiedPhone } from "@/components/PhoneVerify";
import { apiRequest } from "@/lib/client/api";
import type { PublicTicket } from "@/lib/types";

export interface Coordinates {
  lat: number;
  lng: number;
}

/** Everything the citizen has entered on the report form. */
export interface ReportDraft {
  title: string;
  description: string;
  category: string;
  address: string;
  email: string;
  location: Coordinates | null;
  image: Blob | null;
  audio: Blob | null;
}

/** The server's answer to a submitted report. */
export interface ReportResult {
  /** True when the report was added to an existing nearby ticket instead of creating a new one. */
  merged: boolean;
  reason?: string;
  ticket: PublicTicket;
  aiSource: "gemini" | "fallback";
  privateLink: string;
  unverified?: boolean;
}

function toFormData(draft: ReportDraft, location: Coordinates, verifiedPhone: VerifiedPhone | null): FormData {
  const form = new FormData();
  form.set("title", draft.title);
  form.set("description", draft.description);
  form.set("category", draft.category);
  form.set("address", draft.address);
  form.set("email", draft.email);
  form.set("lat", String(location.lat));
  form.set("lng", String(location.lng));
  if (draft.image) form.set("image", draft.image, "photo.jpg");
  if (draft.audio) form.set("audio", draft.audio, `voice.${draft.audio.type.split("/")[1] || "webm"}`);
  if (verifiedPhone) {
    form.set("phone", verifiedPhone.phone);
    form.set("otp", verifiedPhone.otp);
    form.set("otpChallenge", verifiedPhone.otpChallenge);
  }
  return form;
}

/**
 * Drives the two-step submission of a report: validate the draft and open the
 * phone-verification dialog, then send the report with the verified phone.
 */
export function useReportSubmission(draft: ReportDraft) {
  const t = useT();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  /**
   * Step 1: check the draft, then open the phone-verification step. These
   * checks give instant, friendly feedback; the server validates everything
   * again when the report arrives.
   */
  function startVerification(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!draft.location) return setError(t("report.error.needLocation"));
    if (!draft.title.trim() && !draft.description.trim() && !draft.audio)
      return setError(t("report.error.needContent"));
    setVerifying(true);
  }

  /**
   * Step 2: send the report together with the verified phone and one-time
   * code, or with `null` to send it unverified. Returns an error message for
   * the verification dialog to show, or null on success.
   */
  async function sendReport(verifiedPhone: VerifiedPhone | null): Promise<string | null> {
    if (!draft.location) return t("report.error.needLocation");
    // `submitting` disables and relabels the buttons while Gemini works, which
    // prevents double submissions and tells the citizen what is happening.
    setSubmitting(true);
    try {
      const response = await apiRequest<ReportResult>("/api/tickets", {
        method: "POST",
        form: toFormData(draft, draft.location, verifiedPhone),
      });
      if (!response.ok) return response.error || t("common.error.generic");
      setResult(response.data);
      return null;
    } catch {
      return t("common.error.network");
    } finally {
      setSubmitting(false);
    }
  }

  return {
    submitting,
    error,
    /** Shows a problem outside submission itself (location, photo) in the form's alert. */
    showError: setError,
    result,
    verifying,
    startVerification,
    cancelVerification: () => setVerifying(false),
    sendReport,
  };
}
