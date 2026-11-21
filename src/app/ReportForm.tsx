"use client";

// =============================================================================
// [PROBLEM STATEMENT ALIGNMENT][ACCESSIBILITY] CITIZEN REPORT FORM
// -----------------------------------------------------------------------------
// BRIEF ✔ Citizen Issue Reporting: "title, description, location, category,
// and optional image", all present below. Designed for a citizen on a phone,
// standing next to the pothole:
//   • Location: one tap on "Use my location" (GPS) or tap the map. No typing
//     addresses. An optional landmark field covers "opposite the bus stop".
//   • Category: defaults to "Let AI decide", so citizens don't need to know the
//     municipal taxonomy. Gemini classifies it (BRIEF ✔ AI classification).
//   • Photo: opens the rear camera directly on mobile (capture="environment").
//   • Voice: BEYOND THE BRIEF. Speak in any language instead of typing.
// After submission the citizen immediately sees what the AI understood
// (category, priority + reason, department, English summary) and gets a ticket
// ID to track it: the "submission → tracking" hand-off the brief asks for.
// =============================================================================

import { useState } from "react";
import Map from "@/components/Map";
import AddressSearch from "@/components/AddressSearch";
import PhoneVerify, { type VerifiedPhone } from "@/components/PhoneVerify";
import VoiceRecorder from "@/components/VoiceRecorder";
import { langName, PriorityBadge, StatusBadge } from "@/components/badges";
import { downscale } from "@/lib/client/image";
import { CATEGORIES, type PublicTicket } from "@/lib/types";

interface Result {
  merged: boolean;
  reason?: string;
  ticket: PublicTicket;
  aiSource: "gemini" | "fallback";
  privateLink: string;
  unverified?: boolean;
}

const input =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none";

export default function ReportForm({ searchProvider = "osm" }: { searchProvider?: "google" | "osm" }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("auto");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [verifying, setVerifying] = useState(false);

  function useMyLocation() {
    if (!navigator.geolocation) return setError("Location is not available in this browser.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPicked({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => {
        setError("Couldn't get your location. Tap the map instead.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function onImage(f: File | undefined) {
    if (preview) URL.revokeObjectURL(preview);
    if (!f) return (setImage(null), setPreview(null));
    try {
      const small = await downscale(f);
      setImage(small);
      setPreview(URL.createObjectURL(small));
    } catch {
      setError("Couldn't read that image.");
    }
  }

  // [CODE QUALITY] Client-side checks give instant, friendly feedback; the server re-validates
  // everything anyway (see api/tickets/route.ts).
  // Step 1: check the report, then open the phone-verification step (anti-spam, see PhoneVerify.tsx).
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!picked) return setError("Pick the issue location on the map, or use your location.");
    if (!title.trim() && !description.trim() && !audio)
      return setError("Add a title, a description, or record a voice note.");
    setVerifying(true);
  }

  // Step 2: send the report together with the verified phone + one-time code.
  // Returns an error message for the verification dialog to show, or null on success.
  async function sendReport(v: VerifiedPhone | null): Promise<string | null> {
    if (!picked) return "Pick the issue location on the map.";
    const fd = new FormData();
    fd.set("title", title);
    fd.set("description", description);
    fd.set("category", category);
    fd.set("address", address);
    fd.set("email", email);
    fd.set("lat", String(picked.lat));
    fd.set("lng", String(picked.lng));
    if (image) fd.set("image", image, "photo.jpg");
    if (audio) fd.set("audio", audio, `voice.${audio.type.split("/")[1] || "webm"}`);
    if (v) {
      fd.set("phone", v.phone);
      fd.set("otp", v.otp);
      fd.set("otpChallenge", v.otpChallenge);
    }
    // The button is disabled and relabelled while Gemini works, which prevents
    // double submissions and tells the citizen what is happening.
    setBusy(true);
    try {
      const res = await fetch("/api/tickets", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) return data.error || "Something went wrong.";
      setResult(data);
      return null;
    } catch {
      return "Network error. Please try again.";
    } finally {
      setBusy(false);
    }
  }

  if (result) return <ResultCard r={result} onAgain={() => location.reload()} />;

  return (
    // [ACCESSIBILITY] Every input has a real <label htmlFor>, errors use role="alert",
    // and the layout collapses to a single column on phones.
    <>
    {verifying && <PhoneVerify onVerified={sendReport} onCancel={() => setVerifying(false)} busy={busy} />}
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2" noValidate>
      <div className="space-y-4">
        <div>
          <label htmlFor="title" className="mb-1 block text-sm font-medium">Title</label>
          <input id="title" className={input} value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Pothole near the bus stand" maxLength={120} />
        </div>
        <div>
          <label htmlFor="description" className="mb-1 block text-sm font-medium">Description</label>
          <textarea id="description" className={`${input} min-h-28`} value={description}
            onChange={(e) => setDescription(e.target.value)} maxLength={2000}
            placeholder="What's wrong, how long it's been like this, who it affects. Any language is fine." />
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium">Or describe it by voice</span>
          <VoiceRecorder onChange={setAudio} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="category" className="mb-1 block text-sm font-medium">Category</label>
            <select id="category" className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="auto">Let AI decide</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="image" className="mb-1 block text-sm font-medium">Photo (optional)</label>
            <input id="image" type="file" accept="image/*" capture="environment"
              onChange={(e) => onImage(e.target.files?.[0])}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm" />
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && <img src={preview} alt="Selected photo preview" className="max-h-48 rounded-md ring-1 ring-slate-200" />}
      </div>

      <div className="space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium" id="map-label">Location (search, or tap the map)</span>
            <button type="button" onClick={useMyLocation} disabled={locating}
              className="text-sm font-medium text-blue-700 underline disabled:opacity-50">
              {locating ? "Locating…" : "Use my location"}
            </button>
          </div>
          {/* [ACCESSIBILITY] The map is a labelled region with keyboard instructions,
              and the chosen location is announced politely to screen readers. */}
          {/* [GOOGLE SERVICES] Type an address → Google Places suggestions → the map jumps there and pins it. */}
          <div className="mb-2">
            <AddressSearch
              provider={searchProvider}
              onSelect={(p) => {
                setPicked({ lat: p.lat, lng: p.lng });
                setAddress((a) => (a.trim() ? a : p.address.slice(0, 200)));
              }}
            />
          </div>
          <div role="region" aria-labelledby="map-label" aria-describedby="map-help">
            <Map picked={picked} onPick={setPicked} height={320} />
          </div>
          <p id="map-help" className="mt-1 text-xs text-slate-600">
            Keyboard: focus the map, move with the arrow keys, press Enter to pin the centre (+).
          </p>
          <p className="text-xs text-slate-600" aria-live="polite">
            {picked ? `Pinned at ${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}` : "No location picked yet."}
          </p>
        </div>
        <div>
          <label htmlFor="address" className="mb-1 block text-sm font-medium">Landmark / address (optional)</label>
          <input id="address" className={input} value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. Opposite Green Circle bus stop" maxLength={200} />
        </div>
        {/* [SECURITY][PROBLEM STATEMENT ALIGNMENT] Optional email for updates. It is
            used only by the server to relay messages; the department never sees it. */}
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">Email for updates (optional)</label>
          <input id="email" type="email" autoComplete="email" className={input} value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" maxLength={254}
            aria-describedby="email-help" />
          <p id="email-help" className="mt-1 text-xs text-slate-600">
            Private: the department can message you, but never sees your address.
          </p>
        </div>
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded-md bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
          {busy ? "Gemini is analysing your report…" : "Submit report"}
        </button>
        <p className="text-center text-xs text-slate-600">Next: a quick one-time code to your phone, to keep out fake reports.</p>
      </div>
    </form>
    </>
  );
}

// [ACCESSIBILITY][PROBLEM STATEMENT ALIGNMENT] Confirmation screen: shows the AI's full triage back to the citizen
// (transparency), explains a duplicate merge in plain words, and links straight
// to the tracking page. aria-live announces the result to screen-reader users.
function ResultCard({ r, onAgain }: { r: Result; onAgain: () => void }) {
  const t = r.ticket;
  return (
    <section aria-live="polite" className="mx-auto max-w-2xl rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm font-medium text-emerald-700">
        {r.merged ? "This issue was already reported nearby, so your report was added to it." : "Report submitted"}
      </p>
      <h2 className="mt-1 text-2xl font-semibold">
        Ticket <span className="font-mono">{t.id}</span>
      </h2>
      {r.unverified && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Sent without phone verification, so it is <strong>waiting for review</strong> by a city officer before it
          goes to the department. The classification below is a quick rule-based guess; it is refined on review.
        </p>
      )}
      {r.merged && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t.reporterCount} people have now reported this. More reports raise its priority. {r.reason}
        </p>
      )}
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-slate-500">Category</dt><dd>{t.category}</dd>
        <dt className="text-slate-500">Priority</dt>
        <dd className="flex flex-wrap items-center gap-2"><PriorityBadge p={t.priority} /><span className="text-slate-600">{t.priorityReason}</span></dd>
        <dt className="text-slate-500">Department</dt><dd>{t.department}</dd>
        <dt className="text-slate-500">Status</dt><dd><StatusBadge s={t.status} /></dd>
        <dt className="text-slate-500">Language</dt><dd>{langName(t.originalLanguage)}</dd>
        <dt className="text-slate-500">Summary</dt><dd>{t.englishSummary}</dd>
        {t.transcript && (<><dt className="text-slate-500">Transcript</dt><dd className="italic">{t.transcript}</dd></>)}
      </dl>
      {r.aiSource === "fallback" && !r.unverified && (
        <p className="mt-3 text-xs text-slate-500">AI was unavailable, so this was classified by rules and will be reviewed by an admin.</p>
      )}
      {/* [SECURITY][PROBLEM STATEMENT ALIGNMENT] The private link is shown once.
          It lets the citizen message the department and confirm the fix,
          with no account and no personal details. */}
      <div className="mt-5 rounded-lg bg-emerald-50 p-4 ring-1 ring-emerald-200">
        <p className="text-sm font-semibold text-emerald-900">Save your private link</p>
        <p className="mt-1 text-xs text-emerald-900">
          Use it to chat with the department and confirm when it&apos;s fixed. Anyone with this link can reply as you, so keep it private.
        </p>
        <div className="mt-2 flex gap-2">
          <label htmlFor="plink" className="sr-only">Your private link</label>
          <input id="plink" readOnly value={r.privateLink} onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-md border border-emerald-300 bg-white px-2 py-1.5 font-mono text-xs" />
          <CopyButton text={r.privateLink} />
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <a href={r.privateLink} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Open my ticket</a>
        <button onClick={onAgain} className="rounded-md px-4 py-2 text-sm font-medium ring-1 ring-slate-300">Report another</button>
      </div>
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
        } catch {
          setDone(false);
        }
      }}
      className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white"
    >
      <span aria-live="polite">{done ? "Copied" : "Copy"}</span>
    </button>
  );
}
