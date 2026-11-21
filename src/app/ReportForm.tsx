"use client";

import { useEffect, useRef, useState } from "react";
import AddressSearch from "@/components/AddressSearch";
import { useT } from "@/components/I18nProvider";
import LabelledField from "@/components/LabelledField";
import Map from "@/components/Map";
import Photo from "@/components/Photo";
import PhoneVerify from "@/components/PhoneVerify";
import VoiceRecorder from "@/components/VoiceRecorder";
import ResultCard from "@/components/report/ResultCard";
import { type Coordinates, useReportSubmission } from "@/components/report/useReportSubmission";
import { fieldClass, fieldLabelClass } from "@/components/ui";
import { downscale } from "@/lib/client/image";
import { sampleAt } from "@/lib/client/samples";
import { CATEGORIES, LIMITS } from "@/lib/types";

const EMPTY_FIELDS = { title: "", description: "", category: "auto", address: "", email: "" };
type FieldName = keyof typeof EMPTY_FIELDS;
type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * The citizen report form: title, description, location, category and an
 * optional photo. It is designed for a citizen on a phone, standing next to
 * the pothole:
 *   - Location: one tap on "Use my location" (GPS), a search box, or a tap on
 *     the map. An optional landmark field covers "opposite the bus stop".
 *   - Category: defaults to "Let AI decide", so citizens don't need to know
 *     the municipal taxonomy; Gemini classifies the report.
 *   - Photo: opens the rear camera directly on mobile.
 *   - Voice: speak in any language instead of typing.
 *   - Sample: "Try a sample report" fills in a realistic example for a
 *     first-time visitor. It only fills the form; nothing is sent until the
 *     visitor presses Submit and passes the phone step like any other report.
 * After submission the citizen immediately sees what the AI understood
 * (category, priority and reason, department, English summary) and gets a
 * ticket ID to track it.
 */
export default function ReportForm({ searchProvider = "osm" }: { searchProvider?: "google" | "osm" }) {
  const t = useT();
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [photo, setPhoto] = useState<{ blob: Blob | null; previewUrl: string | null }>({
    blob: null,
    previewUrl: null,
  });
  // Object URLs hold the image in memory until revoked; release the last one when the form goes away.
  const previewUrlRef = useRef<string | null>(null);
  useEffect(() => {
    previewUrlRef.current = photo.previewUrl;
  }, [photo.previewUrl]);
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );
  const [audio, setAudio] = useState<Blob | null>(null);
  const [locating, setLocating] = useState(false);
  // How many samples have been filled in, and the announcement for the latest one.
  const [samplesShown, setSamplesShown] = useState(0);
  const [sampleNotice, setSampleNotice] = useState("");
  const submission = useReportSubmission({ ...fields, location, image: photo.blob, audio });

  const updateField = (name: FieldName) => (event: React.ChangeEvent<FieldElement>) =>
    setFields((current) => ({ ...current, [name]: event.target.value }));

  /**
   * Fills the form with the next sample, cycling through them on repeated
   * clicks. The location is set exactly as a map tap or address search would
   * set it, so the map moves and pins it. Focus stays on the button, so a
   * keyboard user can press again for another sample or Tab on into the
   * filled-in form; the live region tells screen-reader users what changed.
   */
  function fillSample() {
    const sample = sampleAt(samplesShown);
    setSamplesShown(samplesShown + 1);
    setFields((current) => ({
      ...current,
      title: sample.title,
      description: sample.description,
      address: sample.address,
      category: "auto",
    }));
    setLocation({ lat: sample.lat, lng: sample.lng });
    setSampleNotice(t("sample.filled", { title: sample.title }));
    submission.showError(null);
  }

  function locateMe() {
    if (!navigator.geolocation) return submission.showError(t("report.error.noGeolocation"));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      () => {
        submission.showError(t("report.error.locationFailed"));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return replacePhoto(null);
    try {
      replacePhoto(await downscale(file));
    } catch {
      // The previous photo and its preview stay as they were.
      submission.showError(t("report.error.imageUnreadable"));
    }
  }

  /** Swaps in the new photo (or clears it) and only then releases the old preview. */
  function replacePhoto(blob: Blob | null) {
    if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    setPhoto({ blob, previewUrl: blob ? URL.createObjectURL(blob) : null });
  }

  if (submission.result)
    return <ResultCard result={submission.result} onReportAnother={() => window.location.reload()} />;

  // Every input has a real label, errors use role="alert", and the layout
  // collapses to a single column on phones.
  return (
    <>
      {submission.verifying && (
        <PhoneVerify
          onVerified={submission.sendReport}
          onCancel={submission.cancelVerification}
          busy={submission.submitting}
        />
      )}
      <form onSubmit={submission.startVerification} className="grid gap-6 lg:grid-cols-2" noValidate>
        <div className="space-y-4">
          {/* Secondary to the form itself: a dashed outline, not a filled button. */}
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-sm text-slate-700">{t("sample.prompt")}</span>
              <button
                type="button"
                onClick={fillSample}
                className="min-h-11 rounded-md px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
              >
                {t("sample.button")}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600">{t("sample.hint")}</p>
            <p className="sr-only" role="status">
              {sampleNotice}
            </p>
          </div>
          <LabelledField id="title" label={t("report.title")}>
            <input
              id="title"
              className={fieldClass}
              value={fields.title}
              onChange={updateField("title")}
              placeholder={t("report.titlePlaceholder")}
              maxLength={LIMITS.title}
            />
          </LabelledField>
          <LabelledField id="description" label={t("report.description")}>
            <textarea
              id="description"
              className={`${fieldClass} min-h-28`}
              value={fields.description}
              onChange={updateField("description")}
              maxLength={LIMITS.description}
              placeholder={t("report.descriptionPlaceholder")}
            />
          </LabelledField>
          <div>
            <span className={fieldLabelClass}>{t("report.voiceLabel")}</span>
            <VoiceRecorder onChange={setAudio} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <LabelledField id="category" label={t("report.category")}>
              <select id="category" className={fieldClass} value={fields.category} onChange={updateField("category")}>
                <option value="auto">{t("report.categoryAuto")}</option>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {t(`category.${category}`)}
                  </option>
                ))}
              </select>
            </LabelledField>
            <LabelledField id="image" label={t("report.photo")}>
              <input
                id="image"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => choosePhoto(event.target.files?.[0])}
                className="block w-full rounded-md border border-dashed border-slate-300 bg-white p-1.5 text-sm text-slate-700 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
              />
            </LabelledField>
          </div>
          {photo.previewUrl && <Photo src={photo.previewUrl} alt={t("report.photoPreviewAlt")} className="max-h-48" />}
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3">
              <span className="text-sm font-medium" id="map-label">
                {t("report.location")}
              </span>
              <button
                type="button"
                onClick={locateMe}
                disabled={locating}
                className="text-sm font-medium text-blue-700 underline disabled:opacity-50"
              >
                {locating ? t("report.locating") : t("report.useMyLocation")}
              </button>
            </div>
            {/* Typing an address shows place suggestions; choosing one moves the map there and pins it. */}
            <div className="mb-2">
              <AddressSearch
                provider={searchProvider}
                onSelect={(place) => {
                  setLocation({ lat: place.lat, lng: place.lng });
                  // Fill the landmark field only if the citizen hasn't typed one.
                  setFields((current) =>
                    current.address.trim() ? current : { ...current, address: place.address.slice(0, LIMITS.address) },
                  );
                }}
              />
            </div>
            {/* The map is a labelled region with keyboard instructions, and the
              chosen location is announced politely to screen readers. */}
            <div role="region" aria-labelledby="map-label" aria-describedby="map-help">
              <Map picked={location} onPick={setLocation} height={320} />
            </div>
            <p id="map-help" className="mt-1 text-xs text-slate-600">
              <span className="sm:hidden">{t("report.mapHelpTouch")}</span>
              <span className="max-sm:sr-only">{t("report.mapHelpKeyboard")}</span>
            </p>
            <p className="text-xs text-slate-600" aria-live="polite">
              {location
                ? t("report.pinnedAt", { lat: location.lat.toFixed(5), lng: location.lng.toFixed(5) })
                : t("report.noLocation")}
            </p>
          </div>
          <LabelledField id="address" label={t("report.landmark")}>
            <input
              id="address"
              className={fieldClass}
              value={fields.address}
              onChange={updateField("address")}
              placeholder={t("report.landmarkPlaceholder")}
              maxLength={LIMITS.address}
            />
          </LabelledField>
          {/* Optional email for updates. Only the server uses it, to relay
            messages; the department never sees it. */}
          <LabelledField id="email" label={t("report.email")}>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={fieldClass}
              value={fields.email}
              onChange={updateField("email")}
              placeholder="you@example.com"
              maxLength={LIMITS.email}
              aria-describedby="email-help"
            />
            <p id="email-help" className="mt-1 text-xs text-slate-600">
              {t("report.emailHelp")}
            </p>
          </LabelledField>
          {submission.error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {submission.error}
            </p>
          )}
          <button
            type="submit"
            disabled={submission.submitting}
            className="w-full rounded-md bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {submission.submitting ? t("report.analysing") : t("report.submit")}
          </button>
          <p className="text-center text-xs text-slate-600">{t("report.nextStep")}</p>
        </div>
      </form>
    </>
  );
}
