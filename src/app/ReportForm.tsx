"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import LabelledField from "@/components/LabelledField";
import Photo from "@/components/Photo";
import PhoneVerify from "@/components/PhoneVerify";
import VoiceRecorder from "@/components/VoiceRecorder";
import LocationPicker from "@/components/report/LocationPicker";
import ResultCard from "@/components/report/ResultCard";
import { usePhotoPreview } from "@/components/report/usePhotoPreview";
import { useReportSubmission } from "@/components/report/useReportSubmission";
import { fieldClass, fieldLabelClass } from "@/components/ui";
import { downscale } from "@/lib/client/image";
import { sampleAt } from "@/lib/client/samples";
import { CATEGORIES, LIMITS, type Coordinates } from "@/lib/types";

const EMPTY_FIELDS = { title: "", description: "", category: "auto", address: "", email: "" };
type FieldName = keyof typeof EMPTY_FIELDS;
type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const ERROR_ID = "report-error";

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
  const photo = usePhotoPreview();
  const [audio, setAudio] = useState<Blob | null>(null);
  // How many samples have been filled in, and the announcement for the latest one.
  const [samplesShown, setSamplesShown] = useState(0);
  const [sampleNotice, setSampleNotice] = useState("");
  const submission = useReportSubmission({ ...fields, location, image: photo.blob, audio });
  // A missing title and description is an error on both fields, tied to the message that explains it.
  const contentErrorProps =
    submission.errorField === "content" ? { "aria-invalid": true, "aria-describedby": ERROR_ID } : {};

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

  async function choosePhoto(file: File | undefined) {
    if (!file) return photo.replacePhoto(null);
    try {
      photo.replacePhoto(await downscale(file));
    } catch {
      // The previous photo and its preview stay as they were.
      submission.showError(t("report.error.imageUnreadable"));
    }
  }

  if (submission.result)
    return <ResultCard result={submission.result} onReportAnother={() => window.location.reload()} />;

  // Every input has a real label, errors use role="alert" and are tied to the
  // fields they are about, and the layout collapses to a single column on phones.
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
              {...contentErrorProps}
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
              {...contentErrorProps}
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
          <LocationPicker
            location={location}
            onLocationChange={setLocation}
            // Fill the landmark field only if the citizen hasn't typed one.
            onPlaceChosen={(place) =>
              setFields((current) =>
                current.address.trim() ? current : { ...current, address: place.address.slice(0, LIMITS.address) },
              )
            }
            onError={submission.showError}
            searchProvider={searchProvider}
            errorId={submission.errorField === "location" ? ERROR_ID : undefined}
          />
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
            <p id={ERROR_ID} role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {submission.error}
            </p>
          )}
          <button
            type="submit"
            disabled={submission.submitting}
            className="w-full rounded-md bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {submission.submitting ? t("report.analysing") : t("report.submit")}
          </button>
          <p className="text-center text-xs text-slate-600">{t("report.nextStep")}</p>
        </div>
      </form>
    </>
  );
}
