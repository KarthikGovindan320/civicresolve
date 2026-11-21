# CivicResolve

AI-powered civic issue reporting **and resolution**. Citizens report potholes, garbage, broken streetlights or leaks by text, photo or **voice in any language**. **Google Gemini** classifies the category, priority and responsible department in one multimodal call, and the issue lands in that **department's work queue**. The department accepts it with a promised fix date, talks to the citizen anonymously (messages **auto-translated** by Gemini), and closes it only with an **after photo that Gemini checks against the original**. The citizen then confirms the fix or reopens it. Every issue has a priority-based deadline; overdue work is escalated to the city admin, and everyone can follow progress on a public map and timeline.

## Live demo
**https://civicresolve-639026421453.asia-south1.run.app** (Google Cloud Run, Mumbai region, Firestore database, secrets in Secret Manager)

| Page | What to try |
|---|---|
| `/` Report | Type a vague report ("Problem on our road"), attach a photo, search a landmark (e.g. "Vellore Fort") or tap the map, then submit. The phone check shows a **demo code on screen** (SMS gateway not connected yet): enter it and Gemini returns category, priority + reason, department and an English summary in a few seconds. Keep the private link it gives you. |
| `/track` | Public dashboard: open/critical/overdue counts, per-department on-time rate, city map with every issue, filters. |
| `/track/<id>?k=…` | The citizen's private page: anonymous chat with the department (write in Tamil or Hindi: Gemini translates), before/after photos with Gemini's verdict, "Yes, it's fixed" / "Not fixed: reopen". |
| `/staff` | Department and city-admin portal: sign in with a passcode below. A department sees only its own queue; the admin sees everything, including the review queue for unverified reports. |

Verified end to end on the live deployment (Gemini calls included): photo + text classification, a Tamil duplicate report merged into an English one, a "sparking wire near a bus stop" report forced to Critical by the safety rules, Tamil ↔ English message translation, before/after verification ("fixed" for a real repair, "unclear" for an unrelated photo), reopen and confirm, transfer, the admin review queue for unverified reports, and 401/403 for every unauthorised action.

### Staff passcodes for the live demo (judges)
| Role | Passcode |
|---|---|
| **City admin** (all departments, escalations, review queue, AI overrides) | `admin-9ajtynp1` |
| Public Works (Roads) | `roads-t1stril5` |
| Sanitation | `sanitation-towq1fnp` |
| Electricity Board (TANGEDCO) | `electricity-jejl43zh` |
| Water Supply | `water-l85yq4tf` |
| Drainage & Sewerage | `drainage-69bgl1o2` |
| General Administration | `general-6gdccawl` |

Try signing in as one department and opening another department's ticket: the server refuses it (403).

### At a glance: the judging criteria
| Criterion | What CivicResolve does |
|---|---|
| **Problem statement alignment** | Every required feature (reporting, Gemini classification, priority detection, department recommendation, tracking dashboard, admin dashboard) **plus** a full resolution loop: accept with a promised date, anonymous translated chat, fixes accepted only with a Gemini-checked after photo, citizen confirm/reopen, SLA deadlines with escalation. |
| **Google services** | Gemini (multimodal triage, duplicate detection, translation, before/after verification) · Cloud Run · Firestore · Cloud Build · Artifact Registry · Secret Manager · Cloud Logging · Places API (New) integrated. |
| **Security** | Server-enforced per-department access, HMAC private links (never stored), OTP anti-spam with numbers that stay private, review queue for unverified reports, rate limits, file-signature upload checks, CSP + security headers, secrets in Secret Manager. |
| **Testing** | 80 automated Vitest tests including the full API lifecycle, plus an end-to-end run on the live deployment with real Gemini calls. |
| **Accessibility** | Labelled controls, keyboard-operable map and address search (WAI-ARIA combobox), screen-reader announcements, voice reports in any language, text alongside every colour. |
| **Efficiency** | One Gemini call per report, lightest model for short tasks, no cron jobs (deadlines computed on read), photos downscaled in the browser, small standalone container. |
| **Code quality** | TypeScript strict, one shared domain model, schema-validated AI output, lint and typecheck clean, comments tagged by criterion. |

## The workflow
```
Citizen reports (text / photo / voice, any language)
  → Gemini: category, priority + reason, department, English summary, transcript
  → safety rules (live wire / open manhole / sewage → Critical) · duplicate check (merge + reporter count)
  → DEPARTMENT QUEUE ("To accept")
      → Accept + promise a fix date ................ status: In Progress (citizen notified)
      → or Transfer to the right department, with a reason
      → Message the citizen ↔ citizen replies ....... anonymous, auto-translated both ways
      → Mark fixed with an AFTER photo .............. Gemini compares before/after → verdict
  → CITIZEN (private link, no account): "Yes, it's fixed" or "Not fixed: reopen" (+ new photo)
      → auto-closes after 3 days without a reply
SLA per priority (Critical 24 h · High 3 d · Medium 7 d · Low 14 d) → overdue → escalated to the city admin
```
**Roles:** citizen (anonymous private link) · department staff (own queue only) · city admin (all departments, escalations, overrides of the AI).

**Google stack:** Gemini API · Cloud Run · Firestore · Cloud Build · Artifact Registry · Secret Manager · Cloud Logging · Places API (New) (integrated and tested; switched on by adding a key, the live demo currently uses the OpenStreetMap fallback)

---

## How this submission meets each judging parameter

Every relevant line in the code is tagged with the parameter it addresses. Search the repo for these tags:
`[PROBLEM STATEMENT ALIGNMENT]` `BRIEF ✔` `[CODE QUALITY]` `[SECURITY]` `[EFFICIENCY]` `[TESTING]` `[ACCESSIBILITY]` `[GOOGLE SERVICES]`

### Problem Statement Alignment
Every expected feature is implemented and tested end to end (`tests/api.test.ts`).

| Expected feature | Where |
|---|---|
| Citizen Issue Reporting (title, description, location, category, optional image) | `src/app/ReportForm.tsx`, `src/app/api/tickets/route.ts` (POST) |
| AI-Powered Classification with Gemini | `src/lib/gemini.ts` → `classifyIssue()` |
| Priority Detection (urgency + public impact) | `src/lib/gemini.ts` (rubric), `src/lib/rules.ts` (safety rules, reporter-count boost) |
| Department Recommendation | `src/lib/gemini.ts` (AI), `src/lib/types.ts` → `CATEGORY_DEPARTMENT` (fallback routing) |
| Issue Tracking Dashboard (Reported / In Progress / Resolved) | `src/app/track/page.tsx`, `src/app/track/[id]/page.tsx` |
| Admin Dashboard (review, update statuses, manage) | `src/app/staff/page.tsx`, `src/app/staff/TicketCard.tsx`, `src/app/api/tickets/[id]/route.ts` (PATCH) |
| "Visualize progress towards resolution" | per-ticket progress bar and timeline, city map, live statistics (`src/components/Stats.tsx`) |

Beyond the brief, to make it a real resolution process rather than a reporting form:

| Addition | Where |
|---|---|
| Department sign-in and per-department work queues (role-based access control) | `src/lib/auth.ts`, `src/app/staff/` |
| Accept with a promised fix date · transfer to another department with a reason | `src/app/api/tickets/[id]/route.ts` |
| Anonymous two-way messaging, **auto-translated by Gemini** | `src/app/api/tickets/[id]/messages/route.ts`, `src/components/MessageThread.tsx` |
| Proof of fix: after photo **verified by Gemini** against the before photo | `src/app/api/tickets/[id]/resolve/route.ts`, `gemini.ts` → `verifyResolution()` |
| Citizen confirms or reopens the fix · auto-close | `src/app/api/tickets/[id]/confirm/route.ts`, `src/app/track/[id]/CitizenPanel.tsx` |
| SLA deadlines, overdue flags, escalations, per-department on-time rate | `src/lib/workflow.ts`, `src/components/Stats.tsx` |
| Email notifications (privacy relay: staff never see addresses) | `src/lib/notify.ts` |
| Multilingual **voice** reports | `src/components/VoiceRecorder.tsx` |
| **Address search with Google Places autocomplete** (keyboard-accessible combobox; OpenStreetMap fallback) | `src/lib/places.ts`, `src/app/api/places/route.ts`, `src/components/AddressSearch.tsx` |
| **Anti-spam phone verification (OTP)**: every report is tied to a verified mobile number that stays private; reports sent without one are kept in a separate admin review bucket | `src/lib/otp.ts`, `src/app/api/otp/route.ts`, `src/components/PhoneVerify.tsx` |
| **AI duplicate detection and merging** · non-overridable **life-safety rules** | `src/app/api/tickets/route.ts`, `src/lib/rules.ts` |

### Code Quality
- TypeScript strict mode; one domain model (`src/lib/types.ts`) drives the Gemini schema, runtime validation, API validation and the UI, so values can't drift apart.
- Clear layers: UI → API routes → domain logic (`rules.ts`, `gemini.ts`) → `Store` interface (Firestore or local file).
- Gemini output is never trusted blindly: JSON-schema-constrained, then validated with zod.
- ESLint clean, `tsc` clean, 80 automated tests.

### Security
- Role-based access control enforced server-side: a department can act only on its own tickets; only the admin can override (`src/lib/auth.ts` → `canActOn`). Constant-time passcode checks; fails closed in production when passcodes aren't configured.
- Anonymous citizens: private links are `HMAC-SHA256(server secret, salt)`. The link itself is never stored, so a database leak can't produce working links. Emails are never returned by any API; staff can message citizens without ever learning who they are.
- Audience-specific views (`toPublic` / `toPrivate` in `src/lib/workflow.ts`): public pages never contain messages or reporter data, and server pages pass only sanitised data to client components.
- **Accountability against spam:** reports require an OTP-verified mobile number (stateless HMAC-signed challenge, 5-minute expiry, rate-limited per IP and per number). The number is stored only on the private reporter record and never returned by any API, shown to staff or logged, so it can be used solely to trace misuse. Reports sent without verification are not lost, but are held in a separate bucket: rule-classified (no Gemini spend), limited to 3 per device per window, and invisible to the public and departments until the city admin approves them. (SMS sending is a stub until a gateway is connected; the demo shows the code on screen.)
- Per-IP rate limiting on report submission, which also protects the Gemini quota (`src/lib/security.ts`).
- Uploads checked by **file signature**, not the browser's claim; size caps on images and audio; audio MIME allow-list.
- Strict input validation and enum whitelisting on every write (`api/tickets/route.ts`, `api/tickets/[id]/route.ts`).
- Security headers: CSP, X-Frame-Options, nosniff, Permissions-Policy, HSTS (`next.config.ts`).
- Secrets only in env / **Secret Manager**, never in the repo or the browser; `server-only` guards stop database code reaching client bundles.
- Prompt-injection mitigation: citizen text is passed as labelled data, and model answers are restricted to enums and validated.
- Logs carry IDs and labels only, never citizens' text, photos or locations.

### Efficiency
- **One** Gemini call per report does classification, priority, department, translation and transcription.
- Two model chains: judgement-heavy work (classification, photo checks) uses the stronger model; short text work (translation, duplicate matching) uses the lightest model (about 1 s). English-to-English messages skip AI entirely.
- Deadlines, overdue flags and auto-close are computed when tickets are read: no cron jobs or background workers, and a stateless Cloud Run service.
- Duplicate detection filters by distance first, then asks AI only about the 5 nearest candidates; the Firestore query reads only open tickets of the same category.
- Fastest-first model chain with a 25 s total budget; low "thinking" level for a short triage task.
- Photos downscaled in the browser (about 4 MB → 150 KB) before upload; images served separately and cached.
- Leaflet code-split and loaded only on map pages; standalone Next.js build for small images and fast Cloud Run cold starts.

### Testing
`npm test` runs **80 tests** (Vitest) in about a second, with no network needed:
- `tests/rules.test.ts`: safety rules, priority boost and its cap, idempotency, distance maths.
- `tests/gemini.test.ts`: fallback classifier, language detection, behaviour with no API key.
- `tests/security.test.ts`: file-signature sniffing, rate limiter, constant-time auth, fail-closed production auth.
- `tests/workflow.test.ts`: SLA deadlines, overdue, auto-close, private-link tokens, privacy of public/private views, role mapping and per-department access.
- `tests/places.test.ts`: Google Places request shape and parsing (stubbed HTTP), field mask, input validation, graceful failure, OpenStreetMap fallback.
- `tests/otp.test.ts`: phone normalisation, code verification, number binding, expiry and tamper resistance.
- `tests/store.test.ts`: regression tests for bugs found by driving the live app in a real browser (a wiped data directory, date formatting).
- `tests/api.test.ts`: the full lifecycle through the real route handlers: report → routed → other departments refused (403) → accept → two-way messaging (strangers refused) → fix refused without photo → fix with photo → only the citizen can confirm → closed; plus transfer (old department loses access), citizen reopen, admin overrides, validation, rate limiting and no private data in public responses.

### Accessibility
- Every control has a real label; errors use `role="alert"`; results and recording state are announced with `aria-live`.
- Fully keyboard-operable, including the **map** (arrow keys to move, Enter to pin); skip link; strong visible focus ring.
- Voice input for citizens who can't type comfortably; `lang` attributes so screen readers pronounce Tamil and Hindi correctly.
- Priority and status always shown as text, not colour alone; respects `prefers-reduced-motion`.

### Google Services
| Service | Use |
|---|---|
| **Gemini API** | Multimodal (text + image + audio) classification, priority, department, transcription; duplicate judgement; two-way message translation; before/after photo verification of fixes |
| **Places API (New)** | Address autocomplete on the report form: type a landmark, pick a suggestion, the map pins it (server-side proxy, session tokens, Essentials-only field mask). Enabled by setting `GOOGLE_MAPS_API_KEY`; without it the same box searches OpenStreetMap |
| **Cloud Run** | Hosts the app (serverless, HTTPS, scales to zero) |
| **Firestore** | Ticket database (Native mode, asia-south1), transactional ID counter, server-side filtered queries; photos capped at 700 KB so they always fit a Firestore document |
| **Cloud Build + Artifact Registry** | Builds and stores the container from source (`gcloud run deploy --source`) |
| **Secret Manager** | Holds the Gemini API key, staff passcodes, link secret and SMTP credential |
| **Gmail SMTP** (optional) | Email notifications to citizens |
| **Cloud Logging** | Structured JSON logs (`src/lib/log.ts`) with severity and searchable events |

---

## Run locally
```sh
cp .env.example .env.local   # add GEMINI_API_KEY
npm install
npm run dev                  # http://localhost:3000
npm test                     # 80 tests
```
Staff portal: http://localhost:3000/staff. Dev passcodes: `admin123` (city admin), `roads123`, `sanitation123`, `electricity123`, `water123`, `drainage123`, `general123` (departments).
Data is stored in `./data/tickets.json` (seeded from `seed/vellore_tickets.json`). Delete `./data` to reset.

## Deploy to Google Cloud Run
```sh
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com secretmanager.googleapis.com
gcloud firestore databases create --location=asia-south1
printf '%s' "<gemini-key>"      | gcloud secrets create gemini-api-key --data-file=-
printf '%s' "<admin-passcode>"  | gcloud secrets create admin-passcode --data-file=-
printf '%s' '{"Public Works (Roads)":"…","Sanitation":"…","Electricity Board (TANGEDCO)":"…","Water Supply":"…","Drainage & Sewerage":"…","General Administration":"…"}' \
  | gcloud secrets create dept-passcodes --data-file=-
openssl rand -base64 32 | tr -d '\n' | gcloud secrets create link-secret --data-file=-
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
for s in gemini-api-key admin-passcode dept-passcodes link-secret; do
  gcloud secrets add-iam-policy-binding $s \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor
done
gcloud run deploy civicresolve --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars STORE=firestore \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest,ADMIN_PASSCODE=admin-passcode:latest,DEPT_PASSCODES=dept-passcodes:latest,LINK_SECRET=link-secret:latest
```
Optional address autocomplete: in the same project enable `places.googleapis.com`, create an API key restricted to "Places API (New)", store it as a `maps-api-key` secret, and add `GOOGLE_MAPS_API_KEY=maps-api-key:latest` to `--set-secrets`. Without it the search box uses OpenStreetMap.
Optional email: create an `smtp-url` secret (`smtps://you%40gmail.com:<app-password>@smtp.gmail.com:465`), add `SMTP_URL=smtp-url:latest` to `--set-secrets`, and set `PUBLIC_BASE_URL` to the service URL.
Firestore is seeded automatically on the first request. If Firestore asks for a composite index for the duplicate-check query (`category` + `status`), the app falls back to filtering in memory until it is created.

## Roadmap
- **Citizen mobile app** (Android first): report on the spot with the camera, GPS and voice, push notifications instead of email, offline drafts. The REST API under `src/app/api/` is already client-agnostic, so the app reuses it unchanged.
- **Field-staff mobile app**: take the after photo at the site and close the ticket there.
- Real SMS delivery for the OTP (the `sendSms()` hook in `src/lib/otp.ts`; needs India DLT sender/template registration).
- Google Places autocomplete switched on in production; ward boundaries and per-ward dashboards.

## Stack
Next.js 16 · TypeScript · Tailwind · Google Gemini (`@google/genai`) · Firestore · Leaflet + OpenStreetMap · Vitest
