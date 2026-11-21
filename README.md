# CivicResolve

AI-powered civic issue reporting **and resolution**. Citizens report potholes, garbage, broken streetlights or leaks by text, photo or **voice in any language**. **Google Gemini** classifies the category, priority and responsible department in one multimodal call, and the issue lands in that **department's work queue**. The department accepts it with a promised fix date, talks to the citizen anonymously (messages **auto-translated** by Gemini), and closes it only with an **after photo that Gemini checks against the original**. The citizen then confirms the fix or reopens it. Every issue has a priority-based deadline; overdue work is escalated to the city admin, and everyone can follow progress on a public map and timeline.

## Chosen vertical
**Civic issue reporting and resolution (smart city / citizen services).** The persona is an ordinary resident of an Indian city (the demo is set in Vellore, Tamil Nadu) who sees a pothole, an overflowing drain or a sparking wire and wants it fixed, often speaking Tamil or Hindi rather than English. The second persona is the municipal department that has to fix it, and the third is the city admin who has to see what is overdue.

The problem is not just *reporting*: complaints today go into a black box, are routed to the wrong office, get closed without being fixed, and citizens never hear back. CivicResolve is an AI assistant that turns a messy, multilingual complaint into a routed, prioritised, trackable job, and keeps the department accountable until the citizen confirms the fix.

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
| **Testing** | 227 automated Vitest tests (pure domain logic, component tests with Testing Library, mocked-Gemini answer validation, store concurrency, every staff action, the full API lifecycle, security edge cases, i18n) with enforced coverage thresholds, plus an end-to-end run on the live deployment with real Gemini calls. |
| **Accessibility** | Labelled controls, keyboard-operable map and address search (WAI-ARIA combobox), screen-reader announcements, voice reports in any language, text alongside every colour. |
| **Efficiency** | One Gemini call per report, lightest model for short tasks, no cron jobs (deadlines computed on read), photos downscaled in the browser, small standalone container. |
| **Code quality** | Layered architecture (thin routes → services → pure domain logic → store), TypeScript strict, one shared domain model, zod-validated inputs and AI output, and an enforced quality gate: complexity and function-size limits, zero lint warnings, Prettier, duplicate-code scan, coverage thresholds, CI on every push. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). |

## Approach and logic
Gemini does the judgement work, and deterministic rules wrap it so the outcome is predictable and safe. Every decision the app takes, and what it is based on:

| Context the app sees | Decision | Where |
|---|---|---|
| Report text, photo and/or voice note, in any language | One multimodal Gemini call returns category, priority + a written reason, responsible department, detected language, English summary and transcript (schema-constrained JSON, validated with zod) | `src/lib/gemini.ts` → `classifyIssue()`, prompts in `src/lib/ai/prompts.ts` |
| Gemini unavailable or returns invalid output | Keyword classifier + the category the citizen chose; the report is never lost | `gemini.ts` → `fallbackClassify()` |
| Words like "live wire", "open manhole", "sewage overflow" (English, Tamil, Hindi) | Priority forced to **Critical**; nobody, including staff, can lower it | `src/lib/rules.ts` |
| An open ticket of the same category within 200 m | The 5 nearest go to a light Gemini call: same physical problem? If yes, the report **joins** that ticket (reporter count +1) instead of creating a duplicate | `api/tickets/route.ts`, `gemini.ts` → `findDuplicate()` |
| 3+ / 6+ citizens on one ticket (public impact) | Priority raised one / two levels (capped at High; Critical stays rule-only) | `rules.ts` → `effectivePriority()` |
| Priority | Deadline: Critical 24 h · High 3 days · Medium 7 days · Low 14 days; past it → overdue → escalated to the admin | `src/lib/workflow.ts` |
| Phone verified by OTP | Normal path: Gemini triage, straight into the department queue | `api/tickets/route.ts` |
| No phone verification | Kept, but in a separate **review bucket**: no Gemini spend, hidden from the public and departments until the admin approves it | `api/tickets/route.ts`, `staff/page.tsx` |
| Department marks it fixed | Needs an after photo; Gemini compares it with the before photo and records fixed / not fixed / unclear with a reason | `api/tickets/[id]/resolve/route.ts` |
| Citizen's answer to the fix | Confirm → closed; reopen → back to In Progress (reopen count shown to the admin); silence → auto-close after 3 days | `api/tickets/[id]/confirm/route.ts` |
| Message written in Tamil or Hindi (either side) | Translated by Gemini and shown under the original; English-to-English skips the AI | `api/tickets/[id]/messages/route.ts` |

## How it works
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

```mermaid
flowchart LR
  C[Citizen browser] -->|report + photo / voice| R[Next.js API on Cloud Run]
  R -->|text, image, audio| G[Gemini API]
  G -->|validated JSON| R
  R --> F[(Firestore)]
  R -->|own queue only| D[Department staff]
  R -->|all queues, review bucket| A[City admin]
  R -->|private link: HMAC token| C
  S[Secret Manager] -.->|API key, passcodes, link secret| R
```
What each side can see: the public sees tickets without any reporter data or messages; a department sees only its own tickets and never a citizen's phone or email; the citizen sees their own ticket's conversation through a private link that is never stored on the server.

**Roles:** citizen (anonymous private link) · department staff (own queue only) · city admin (all departments, escalations, overrides of the AI).

**Google stack:** Gemini API · Cloud Run · Firestore · Cloud Build · Artifact Registry · Secret Manager · Cloud Logging · Places API (New) (integrated and tested; switched on by adding a key, the live demo currently uses the OpenStreetMap fallback)

## Assumptions and limitations
- **SMS is a stub.** Indian law (TRAI DLT) requires a registered sender and template before an OTP SMS can reach arbitrary numbers, so the code is shown on screen in a clearly labelled demo note. `sendSms()` in `src/lib/otp.ts` is the single integration point.
- **Address search** uses OpenStreetMap on the live demo; Google Places (New) is implemented and tested and switches on with a `GOOGLE_MAPS_API_KEY`.
- **One city, Indian phone numbers:** the map, the address bias and the departments are set for Vellore; phone numbers are Indian mobiles (+91, 10 digits).
- **Gemini's before/after verdict is advisory:** it is shown to the citizen and the admin, and the citizen's confirmation is what closes a ticket.
- **Rate limits are kept in memory per Cloud Run instance** (enough for a demo scale; a shared store such as Memorystore would be used at city scale).
- **Merged duplicates share one conversation** with the department, without any reporter identity.
- **Staff sign in with passcodes** (one per department + admin) rather than individual accounts; demo passcodes are published above for the judges and will be rotated after judging.

---

## How this submission meets each judging parameter

The code explains *why* in plain comments next to the decisions, and every exported function has a TSDoc summary. The architecture, request flows and trust boundaries are described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Problem Statement Alignment
Every expected feature is implemented and tested end to end (`tests/api.test.ts`).

| Expected feature | Where |
|---|---|
| Citizen Issue Reporting (title, description, location, category, optional image) | `src/app/ReportForm.tsx`, `src/app/api/tickets/route.ts` → `src/lib/services/report.ts` |
| AI-Powered Classification with Gemini | `src/lib/gemini.ts` → `classifyIssue()`, prompts in `src/lib/ai/prompts.ts` |
| Priority Detection (urgency + public impact) | `src/lib/gemini.ts` (rubric), `src/lib/rules.ts` (safety rules, reporter-count boost) |
| Department Recommendation | `src/lib/gemini.ts` (AI), `src/lib/types.ts` → `CATEGORY_DEPARTMENT` (fallback routing) |
| Issue Tracking Dashboard (Reported / In Progress / Resolved) | `src/app/track/page.tsx`, `src/app/track/[id]/page.tsx` |
| Admin Dashboard (review, update statuses, manage) | `src/app/staff/`, `src/app/api/tickets/[id]/route.ts` → `src/lib/services/ticket-actions.ts` |
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
| **AI duplicate detection and merging** · non-overridable **life-safety rules** (English, Tamil, Hindi) | `src/lib/services/report.ts`, `src/lib/rules.ts` |
| **Interface in English, தமிழ் and हिंदी** (citizen pages; remembered per device, rendered on the server so there is no flash of English) | `src/lib/i18n/`, `src/components/SettingsMenu.tsx` |
| **High-contrast and larger-text modes** | `src/app/globals.css`, `src/components/SettingsMenu.tsx` |
| **"Try a sample report"**: fills the form with realistic Vellore examples (one in Tamil, one in Hindi) so anyone can see the AI triage in one click | `src/lib/client/samples.ts`, `src/app/ReportForm.tsx` |

### Code Quality
- **Layers** (details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)): route handlers in `src/app/api/` only parse, authorise and respond; use cases live in `src/lib/services/` (`report.ts`, `ticket-actions.ts`); business rules are pure functions (`rules.ts`, `workflow.ts`); persistence sits behind a `Store` interface (Firestore or a local file); AI sits behind one client with prompts, model chains and fallbacks in `src/lib/ai/`.
- **One domain model** (`src/lib/types.ts`) drives the Gemini schema, the zod validators, the API and the UI, including the shared input `LIMITS`, so values can't drift apart.
- **Validated boundaries, no casts:** staff actions are parsed with a zod discriminated union (`src/lib/schemas.ts`) and dispatched by an exhaustive `switch` to one pure function per action; every Gemini answer (triage, duplicates, translation, proof of fix) is JSON-schema-constrained and then zod-validated; records read back from the database are parsed against the domain model (`src/lib/records.ts`) instead of being cast; errors use typed `Result` values and one `fail()` helper.
- **Data integrity:** every change to an existing ticket is an atomic read-modify-write (`Store.update`: a Firestore transaction in production, a single-writer queue locally), and a new ticket's id and record are written in one transaction, so simultaneous requests never overwrite each other or share an id.
- **Small, focused units:** UI split into small components (staff actions, ticket page sections, report hooks); shared client helpers for API calls and formatting.
- **Enforced quality gate** (`npm run check`, also run by GitHub Actions on every push):

| Gate | Tool | Rule |
|---|---|---|
| Types | `tsc --noEmit` | TypeScript strict, no errors |
| Lint | ESLint | zero warnings; no non-null assertions; server code: complexity ≤ 12, nesting ≤ 3, functions ≤ 60 lines, ≤ 4 params; components: complexity ≤ 15 |
| Formatting | Prettier | whole repo |
| Duplication | jscpd | 0 clones (≥ 8 lines) |
| Tests | Vitest + v8 coverage | 227 tests; coverage thresholds on server code (statements 85 %, branches 79 %, functions 88 %, lines 89 %) |
| Build | `next build` | production build in CI |

### Security
- Role-based access control enforced server-side: a department can act only on its own tickets; only the admin can override (`src/lib/auth.ts` → `canActOn`). Constant-time passcode checks; fails closed in production when passcodes aren't configured.
- Anonymous citizens: private links are `HMAC-SHA256(server secret, salt)`. The link itself is never stored, so a database leak can't produce working links. Emails are never returned by any API; staff can message citizens without ever learning who they are.
- Audience-specific views (`toPublic` / `toPrivate` in `src/lib/workflow.ts`): public pages never contain messages or reporter data, and server pages pass only sanitised data to client components.
- **Accountability against spam:** reports require an OTP-verified mobile number (stateless HMAC-signed challenge, 5-minute expiry, rate-limited per IP and per number). The number is stored only on the private reporter record and never returned by any API, shown to staff or logged, so it can be used solely to trace misuse. Reports sent without verification are not lost, but are held in a separate bucket: rule-classified (no Gemini spend), limited to 3 per device per window, and invisible to the public and departments until the city admin approves them. (SMS sending is a stub until a gateway is connected. The on-screen demo code must be switched on explicitly in production with `OTP_DEMO_CODES=true`; without it, or a gateway, the server refuses to issue codes rather than hand them out.)
- Per-IP rate limiting on report submission, which also protects the Gemini quota (`src/lib/security.ts`).
- Uploads checked by **file signature**, not the browser's claim: images (JPEG/PNG/WebP/GIF) and voice notes (WebM/Ogg/MP4/WAV/MP3/FLAC); size caps on both.
- Strict input validation and enum whitelisting on every write (`api/tickets/route.ts`, `api/tickets/[id]/route.ts`).
- Security headers: CSP, X-Frame-Options, nosniff, Permissions-Policy, HSTS (`next.config.ts`).
- Secrets only in env / **Secret Manager**, never in the repo or the browser; `server-only` guards stop database code reaching client bundles. Every HMAC key comes from one helper (`src/lib/secrets.ts`) that fails closed in production: if a signing secret is missing, nothing is signed or verified, and no key is ever derived from a passcode.
- Prompt-injection mitigation: citizen text is fenced in `<report>` tags and declared as data, and every model answer (triage, duplicate matching, translation, proof of fix) is restricted by a JSON schema, then validated with zod; a duplicate id is accepted only if it is one of the real nearby candidates. Internal AI errors are logged, never shown to citizens.
- Rate limiting keys on the rightmost `X-Forwarded-For` entry (the one Cloud Run's front end appends), so a forged header can't dodge it.
- Photos of reports held for review are served only with a server-signed link bound to that ticket and photo (or the reporter's own token). Sequential ticket ids can't be used to download them, and the response doesn't reveal that a held ticket exists.
- Logs carry IDs and labels only, never citizens' text, photos or locations.

### Efficiency
- **One** Gemini call per report does classification, priority, department, translation and transcription. A second, lightweight call (duplicate matching) happens only when there are open tickets of the same category within 200 m.
- Two model chains: judgement-heavy work (classification, photo checks) uses the stronger model; short text work (translation, duplicate matching) uses the lightest model (about 1 s). English-to-English messages skip AI entirely.
- Deadlines, overdue flags and auto-close are computed when tickets are read: no cron jobs or background workers, and a stateless Cloud Run service.
- Duplicate detection filters by distance first, then asks AI only about the 5 nearest candidates; the Firestore query reads only open tickets of the same category.
- Fastest-first model chain with a 25 s total budget; low "thinking" level for a short triage task.
- Photos downscaled in the browser (about 4 MB → 150 KB) before upload; images served separately and cached.
- Leaflet code-split and loaded only on map pages; standalone Next.js build for small images and fast Cloud Run cold starts.

### Testing
`npm test` runs **227 tests** (Vitest) in a few seconds with no network. Server tests run in Node; component tests (`*.test.tsx`) run in jsdom with Testing Library and `user-event`; `npm run test:coverage` enforces the coverage thresholds.

| File | What it proves |
|---|---|
| `tests/api.test.ts` | Full lifecycle through the real route handlers: report → routed → other departments refused (403) → accept → two-way messaging (strangers refused) → fix refused without photo → fix with photo → only the citizen can confirm → closed; transfer, reopen, admin overrides, OTP and the review bucket, rate limiting, no private data in public responses |
| `tests/ticket-actions.test.ts` | Every staff action as a pure function: accept (only new, reviewed reports), transfer, review, notes, admin overrides (reopening clears the old proof of fix), audit events, invalid transitions |
| `tests/report.test.ts` | Report pipeline steps: reporter verification, form parsing and limits, routing, duplicate candidate selection, merge and ticket building |
| `tests/rules.test.ts` | Safety rules (English, Tamil, Hindi), priority boost and cap, distance maths |
| `tests/workflow.test.ts` | SLA deadlines, overdue, auto-close, private-link tokens, public/private views, per-department access |
| `tests/security.test.ts` | Image and audio signature checks (the stored type is the one the bytes prove), rate limiter, forged `X-Forwarded-For`, constant-time auth, fail-closed production auth |
| `tests/routes-misc.test.ts` | Staff sign-in check; photo serving, including signed links for held reports |
| `tests/http.test.ts` | Shared request/response helpers |
| `tests/otp.test.ts` | Phone normalisation, code verification, expiry, tamper resistance; production safeguards (no secret → nothing signed, demo codes only when switched on, 503 instead of a code) |
| `tests/places.test.ts` | Google Places request shape and parsing (stubbed HTTP), OpenStreetMap fallback |
| `tests/gemini.test.ts` | Fallback classifier, language detection, behaviour with no API key |
| `tests/gemini-answers.test.ts` | Every AI feature with the model call mocked: valid answers used, malformed answers and failed calls fall back safely, invented duplicate ids refused |
| `tests/i18n.test.ts` | Translation lookup and fallback, every language has every key, preference parsing |
| `tests/client.test.ts` | Client helpers: API requests, formatting |
| `tests/store.test.ts` | Store integrity: corrupt file never overwritten, invalid records skipped, deleted data folder recovered, concurrent creates get distinct ids, overlapping updates all kept, record schema |
| `tests/AddressSearch.test.tsx` | Combobox behaviour (jsdom): suggestions, arrow/Enter/Escape, short query clears the list, visible "no matches" and failure messages, `aria-busy`, session-token rotation |
| `tests/PhoneVerify.test.tsx` | Modal dialog (jsdom): focus moves in, Tab/Shift+Tab wrap, Escape closes and restores focus, remembered number, code request |
| `tests/SettingsMenu.test.tsx` | Language and display toggles (jsdom): `aria-pressed` states, `<html lang>`, focus handling |
| `tests/ReportForm.test.tsx` | Photo preview (jsdom): old preview kept when a new photo is unreadable, object URLs revoked |

### Accessibility
- Every control has a real label; errors use `role="alert"`; results and recording state are announced with `aria-live`.
- Fully keyboard-operable, including the **map** (arrow keys to move, Enter to pin); skip link; strong visible focus ring.
- Voice input for citizens who can't type comfortably; `lang` attributes so screen readers pronounce Tamil and Hindi correctly.
- Priority and status always shown as text, not colour alone; respects `prefers-reduced-motion`.
- **Interface in English, Tamil and Hindi**, with `<html lang>` set accordingly; first visit follows the browser's language.
- **High-contrast mode** (near-black text, dark borders, stronger focus ring) and **larger-text mode** (root font size 122 %, so every rem-based size scales), both remembered per device.
- Layouts checked at 360 px phone width in all three languages; touch targets at least 44 px.

### Google Services
| Service | Use |
|---|---|
| **Gemini API** | Multimodal (text + image + audio) classification, priority, department, transcription; duplicate judgement; two-way message translation; before/after photo verification of fixes |
| **Places API (New)** | Address autocomplete on the report form: type a landmark, pick a suggestion, the map pins it (server-side proxy, session tokens, Essentials-only field mask). Enabled by setting `GOOGLE_MAPS_API_KEY`; without it the same box searches OpenStreetMap |
| **Cloud Run** | Hosts the app (serverless, HTTPS, scales to zero) |
| **Firestore** | Ticket database (Native mode, asia-south1), transactions for every ticket change and for the ID counter, server-side filtered queries; photos capped at 700 KB so they always fit a Firestore document |
| **Cloud Build + Artifact Registry** | Builds and stores the container from source (`gcloud run deploy --source`) |
| **Secret Manager** | Holds the Gemini API key, staff passcodes, link secret and SMTP credential |
| **Gmail SMTP** (optional, off on the live demo) | Email notifications to citizens |
| **Cloud Logging** | Structured JSON logs (`src/lib/log.ts`) with severity and searchable events |

---

## Run locally
```sh
cp .env.example .env.local   # add GEMINI_API_KEY
npm install
npm run dev                  # http://localhost:3000
npm test                     # 227 tests
```
Staff portal: http://localhost:3000/staff. Dev passcodes: `admin123` (city admin), `roads123`, `sanitation123`, `electricity123`, `water123`, `drainage123`, `general123` (departments).
Data is stored in `./data/tickets.json` (seeded from `seed/vellore_tickets.json`). Delete `./data` to reset.

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm test` / `npm run test:coverage` | Test suite / with coverage thresholds |
| `npm run check` | The full quality gate: typecheck, lint, format check, duplicate scan, tests with coverage |
| `npm run build` | Production build (standalone server for Cloud Run) |

### Project structure
```
src/
  app/                 Pages (report, track, citizen ticket page, staff portal) and API routes
    api/               Thin HTTP handlers: parse, authorise, call a service, respond
  components/          Shared UI: map, address search, phone check, chat, settings menu, badges
  lib/
    services/          Use cases: report submission, staff ticket actions
    ai/                Gemini client (model chains, time budget), prompts, keyword fallback
    i18n/              English, Tamil and Hindi dictionaries (English is the typed source of truth)
    client/            Browser helpers: API calls, formatting, image downscaling, sample reports
    types.ts           Domain model shared by the API, the AI schema and the UI
    rules.ts           Safety rules and priority logic (pure)
    workflow.ts        SLAs, privacy views, private links, signed photo URLs (pure)
    schemas.ts         zod validation of staff actions
    store.ts           Store interface: Firestore or local JSON file
    auth.ts, security.ts, otp.ts, http.ts, uploads.ts, places.ts, notify.ts, log.ts
tests/                 227 Vitest tests
docs/ARCHITECTURE.md   Layers, request flows, trust boundaries, AI design
```

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
  --set-env-vars STORE=firestore,OTP_DEMO_CODES=true \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest,ADMIN_PASSCODE=admin-passcode:latest,DEPT_PASSCODES=dept-passcodes:latest,LINK_SECRET=link-secret:latest
```
Optional address autocomplete: in the same project enable `places.googleapis.com`, create an API key restricted to "Places API (New)", store it as a `maps-api-key` secret, and add `GOOGLE_MAPS_API_KEY=maps-api-key:latest` to `--set-secrets`. Without it the search box uses OpenStreetMap.
Optional email: create an `smtp-url` secret (`smtps://you%40gmail.com:<app-password>@smtp.gmail.com:465`), add `SMTP_URL=smtp-url:latest` to `--set-secrets`, and set `PUBLIC_BASE_URL` to the service URL.
Firestore is seeded automatically on the first request. If Firestore asks for a composite index for the duplicate-check query (`category` + `status`), the app falls back to filtering in memory until it is created.

## Roadmap
- Real SMS delivery for the OTP (the `sendSms()` hook in `src/lib/otp.ts`; needs India DLT sender/template registration).
- Google Places autocomplete switched on in production; ward boundaries and per-ward dashboards.

## Stack
Next.js 16 · TypeScript · Tailwind · Google Gemini (`@google/genai`) · Firestore · Leaflet + OpenStreetMap · Vitest
