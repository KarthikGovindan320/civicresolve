# CivicResolve architecture

This document explains how the code is organised, how a request flows through it, and why the main design
decisions were made. The [README](../README.md) covers what the product does and how to run it.

## 1. Layers

```
Browser (React client components)
        │  fetch
        ▼
src/app/api/**/route.ts      HTTP layer: parse input, authorise, call a service, shape the response
        │
        ▼
src/lib/services/*           Use cases: report submission, staff actions, proof of fix, messages
        │
        ├── src/lib/rules.ts, workflow.ts, schemas.ts   Domain logic, unit-tested (deterministic apart from signing keys and random ids)
        ├── src/lib/gemini.ts + src/lib/ai/*            AI features behind one client with fallbacks
        ├── src/lib/auth.ts, security.ts, otp.ts        Access control, rate limits, file checks, OTP
        ├── src/lib/store.ts, records.ts                Persistence behind a `Store` interface
        │                                                (Firestore in production, a JSON file locally);
        │                                                stored records are parsed, never cast
        └── src/lib/secrets.ts                          Signing keys, fail-closed in production
```

Rules that keep the layers honest:

- **Route handlers stay thin.** They read the request (`src/lib/http.ts` helpers), check access, call one
  service function and return JSON. All error responses go through `fail()` so status codes and messages are
  consistent.
- **Domain logic is pure.** Priority rules, SLA deadlines, privacy views (`toPublic` / `toPrivate`) and every
  staff action (`src/lib/services/ticket-actions.ts`) take data in and return data out. That is why they can be
  tested without a server, a database or the AI.
- **One domain model.** `src/lib/types.ts` defines categories, priorities, statuses, departments, the ticket
  shape and the input `LIMITS`. The Gemini response schema, the zod validators, the API and the UI all derive
  from it, so a new category is added in one place.
- **Server code never reaches the browser.** Modules that touch secrets or the database import
  `server-only`, so a mistaken client import fails the build.

## 2. Request flows

### Submitting a report (`POST /api/tickets` → `src/lib/services/report.ts`)

1. **Rate limit** by client IP (the rightmost `X-Forwarded-For` hop, which Cloud Run's front end sets).
2. **`verifyReporter`**: if a phone number and OTP were sent, check the HMAC-signed challenge; a wrong code is
   rejected (401). With no phone, the report is accepted into the review bucket (stricter per-device limit).
3. **`parseReportForm`**: text fields are trimmed and capped with `LIMITS`; the photo and voice note are
   accepted only if their first bytes match an allowed format (not the browser's claimed type).
4. **`classifyReport`**: verified reports go to Gemini in one multimodal call (text + photo + voice) that
   returns category, priority with a reason, department, language, English summary and transcript. The answer
   is constrained by a JSON schema and validated with zod. Unverified reports, or any AI failure, use the
   keyword classifier in `src/lib/ai/fallback.ts`, so a report is never lost.
5. **`findDuplicateTicket`**: open tickets of the same category within 200 m are ranked by distance; the
   nearest few go to a light Gemini call that decides whether it is the same physical problem. The answer
   must be one of the candidate ids.
6. **`mergeIntoDuplicate`** (reporter count +1, which can raise priority, applied atomically to the latest
   version of the ticket) or **`createTicket`** (id and record written in one transaction): safety rules
   (`src/lib/rules.ts`) force Critical for live wires, open manholes and sewage overflow in English, Tamil or
   Hindi, and the SLA deadline follows from the final priority.
7. The citizen receives a **private link** (`/track/<id>?k=<token>`). Only an HMAC salt is stored, never the
   token, so a database leak cannot produce working links.

### Staff actions (`PATCH /api/tickets/[id]` → `src/lib/services/ticket-actions.ts`)

- `loadTicketForStaff` loads the ticket and checks the passcode role: a department may act only on its own,
  non-held tickets; the city admin may act on all.
- The action is then applied inside `updateTicketAtomically` (`src/lib/http.ts`): the latest stored version is
  read, permission is checked again against it (it may have been transferred meanwhile), and the result is
  written in the same transaction. Resolve, confirm/reopen and messages use the same path, so two requests at
  the same moment are applied one after the other and neither is lost.
- The body is parsed with a zod discriminated union on `action` (`src/lib/schemas.ts`), then dispatched to one
  pure function per action by an exhaustive `switch`: `acknowledgeTicket`, `transferTicket`, `reviewTicket`,
  `addTicketNote`, `updateTicket`. Each enforces its own lifecycle rule (for example, only a new, reviewed
  report can be accepted) and returns the updated ticket plus an audit event, or a typed failure.
- Resolving needs proof: `POST /api/tickets/[id]/resolve` requires an after photo, which Gemini compares with the
  before photo (`fixed` / `not_fixed` / `unclear` plus a reason). The citizen then confirms or reopens through
  `POST /api/tickets/[id]/confirm`, authenticated by the private-link token.

### Messages (`POST /api/tickets/[id]/messages`)

Citizen and department talk without either side learning who the other is. Each message is translated by the
light Gemini model when the languages differ (English-to-English skips the AI), and the original is kept next to
the translation.

## 3. Trust boundaries and privacy

| Viewer | Sees | Never sees |
|---|---|---|
| Public (`/track`, `GET /api/tickets`) | Tickets that are not held for review, status, map, statistics | Messages, reporter data, phone numbers, emails, held reports |
| Citizen (private link) | Their ticket, its conversation, proof of fix | Other reporters, staff identities |
| Department staff | Their own department's tickets and conversations | Phone numbers, emails, other departments' tickets, held reports |
| City admin | Every department, the review bucket, overrides | Phone numbers and emails (kept only for misuse investigations) |

Inputs from citizens, from the AI and from the database are all treated as untrusted: citizen text is fenced
as data inside the prompts, every AI answer is schema-validated, every stored record is parsed against the
domain model when read, and internal errors are logged without personal data and never returned to the browser.

Signing keys (private links, held-photo links, OTP challenges) come from `signingSecret()` in
`src/lib/secrets.ts`. In production a missing key stops signing and verification altogether instead of falling
back to a guessable value. The OTP endpoint follows the same rule: without an SMS gateway it shows the demo
code only when `OTP_DEMO_CODES=true` is set, and otherwise answers 503.

## 4. AI design

- **One client, model chains with a time budget** (`src/lib/ai/client.ts`): judgement tasks (triage, photo
  verification) try a stronger chain; short text tasks (translation, duplicate matching) use the lightest model
  first. The whole call has a 25 s budget, split across models, so a slow model cannot hang a request.
- **Prompts live in one place** (`src/lib/ai/prompts.ts`), including the priority rubric (danger to life >
  injury risk > nuisance > cosmetic) and the routing table, generated from `CATEGORY_DEPARTMENT` so the
  model's department choice follows the same rules as the rest of the app.
- **Deterministic guard rails around the model**: safety rules can only raise priority to Critical, staff cannot
  lower it, and the reporter-count boost is capped at High. The AI suggests; the rules decide what must never
  go wrong.

## 5. Storage and deployment

- `Store` interface with two implementations: `FirestoreStore` (Native mode, asia-south1) in production and a
  JSON file store for local development. Photos are stored apart from ticket records so lists stay small.
- Ticket ids come from a counter updated in the same transaction that writes the new ticket. Deadlines, overdue flags and auto-close are computed when a
  ticket is read, so there are no cron jobs or background workers and the service stays stateless.
- Deployed to Cloud Run from source (Cloud Build + Artifact Registry). Secrets (Gemini key, staff passcodes,
  link secret) live in Secret Manager and are injected as environment variables; nothing secret is in the repo
  or the image.

## 6. Quality gates

`npm run check` runs, in order: TypeScript (`tsc --noEmit`), ESLint with complexity and function-size limits
and zero warnings allowed, Prettier, a duplicate-code scan (jscpd) and the Vitest suite with coverage
thresholds. GitHub Actions runs the same command plus a production build on every push.
