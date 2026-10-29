# Stake It

**Incentive-Driven Adaptive Learning Platform**

Stake It is a points-based learning management platform built to improve course completion.
Learners commit platform points ("stake") to a structured course. The stake is returned only
when the course is *actually* completed — verified content by content, module by module, and
finally by a proctored-free but server-verified assessment.

There is **no real money**, no wagering and no financial transaction. Everything uses virtual
platform points.

---

## Problem

Self-paced online courses have a completion problem: the marginal cost of abandoning a course
is zero, so abandonment is rational. Conventional nudges (streaks, badges, emails) do not
change the incentive.

## Solution

Make abandonment *cost something* the learner already holds, and make completion *pay*:

- a stake is locked at enrolment and returned on verified completion;
- progress is verified rather than self-reported (watch segments, graded quizzes, gated
  assessments);
- deadlines are enforced by a scheduled engine, not by the browser being open;
- extra rewards exist for finishing early and for finishing well;
- failure is recoverable — a retry costs no new stake and pays a recovery reward.

---

## Features

**Learner** — register/login, browse and filter the catalogue, view course detail (instructor,
difficulty, duration, stake, reward, ratings), enrol and stake points, optionally choose an
accelerated deadline and commitment stake, learn through sequential modules, watch verified
videos, read material, take graded quizzes and assessments, see locked/unlocked state,
progress, deadlines and at-risk status, view the final weighted score and settlement receipt,
manage the wallet and transaction ledger, review stakes and rewards, retry failed attempts,
rate completed courses, manage notifications.

**MOOC reader** — structured reading lessons with a table of contents, adjustable text size,
estimated reading time, embedded PDF viewer with page position, external resources, inline
knowledge checks that gate the next section, "continue reading" that resumes the last section
and page on any device, and previous/next section navigation — all backed by server-enforced
section unlocking rather than client state.

**Instructor** — dashboard with learner/completion/score/commitment/rating analytics, course
CRUD, a step-based course builder (modules, ordering, videos, readings, quizzes, assessments,
final test, commitment options, preview, publish), a rich-text reading-lesson editor
(sections, reorder, checkpoints with answer keys, PDF upload, external links, preview,
draft/publish), learner roster with exceptional-case actions, per-course analytics and
funnel, reputation tier and badge status.

**Admin** — platform dashboard, user management (roles, activation, point adjustments),
course oversight, instructor roster with reputation metrics, reward pool ledger and
adjustments, badge override, review moderation, platform-wide point ledger, deadline-engine
trigger.

---

## Architecture

```
frontend (React + Vite + Tailwind)
        │  REST/JSON  (Bearer JWT)
        ▼
backend (Express + TypeScript)
   routes → controllers → services → Prisma
        │
        ▼
PostgreSQL
```

- **Routes** parse and validate (zod), then delegate. No business logic.
- **Controllers** translate HTTP ↔ service calls. No business logic.
- **Services** own all business rules and transactions.
- **Prisma** is the only database access path.

Point mutations (staking, returns, forfeitures, rewards, retry settlement) run inside
transactions with row-level locks, so the wallet can never disagree with its ledger.

See [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) for the full rule set and where each rule
is enforced.

---

## Technology stack

| Layer | Choice |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router, Axios |
| Backend | Node.js, Express 4, TypeScript, zod, Pino |
| ORM / DB | Prisma, PostgreSQL |
| Auth | JWT (HS256, local provider) + Supabase Auth adapter (GoTrue + JWKS verification) |
| Jobs | node-cron, in-process scheduler |
| Tests | Vitest, Supertest |
| Containers | Docker, Docker Compose (Postgres + API + nginx-served SPA) |

No MongoDB, no Firebase.

---

## Folder structure

```
Stake It/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          24 models, 16 enums
│   │   └── seed.ts                ledger-consistent demo data
│   ├── src/
│   │   ├── config/                env validation, business constants
│   │   ├── lib/                   prisma, errors, logger, grading, pacing,
│   │   │                          sequence, watch tracking, supabase
│   │   ├── middleware/            auth, rbac, validation, errors, rate limits
│   │   ├── routes/                resource routers
│   │   ├── controllers/           HTTP translation
│   │   ├── services/              18 domain services
│   │   ├── validators/            zod schemas
│   │   ├── jobs/                  cron scheduler
│   │   ├── utils/                 http helpers, dates, serializers
│   │   ├── types/                 shared types + Express augmentation
│   │   ├── app.ts                 express app factory
│   │   └── server.ts              bootstrap + graceful shutdown
│   ├── tests/
│   │   ├── unit/                  pure business logic (no DB)
│   │   └── integration/           real API against a real database
│   │       └── helpers.ts         fixtures + minimal-round-trip harness
│   ├── Dockerfile                 multi-stage API image
│   ├── docker-entrypoint.sh       migrate-then-serve, with migration retries
│   └── .env.example               server-only variables (documented)
├── frontend/
│   ├── src/
│   │   ├── components/ui/         buttons, chips, fields, tables, modal, alerts…
│   │   ├── components/domain/     course cards, learning tree, video player,
│   │   │                          question runner, settlement receipt, charts
│   │   ├── context/               auth, toast
│   │   ├── hooks/                 useAsync, useAsyncAction, useCountdown…
│   │   ├── layouts/               AppShell, AuthLayout
│   │   ├── pages/                 auth, learner, instructor, admin, shared, errors
│   │   ├── router/                route table, guards, error boundary
│   │   ├── services/              axios client + typed endpoint layer
│   │   ├── types/                 API contract types
│   │   └── utils/                 formatting helpers
│   ├── nginx.conf                 SPA fallback, /api proxy, security headers
│   ├── Dockerfile                 build the SPA, serve with nginx
│   └── .env.example               VITE_* only (public values)
├── docs/
│   ├── BUSINESS_RULES.md          authoritative rule set + enforcement map
│   └── PROJECT_STATUS.md          verification report and known limitations
├── docker-compose.yml             api + web, managed (Supabase) database
├── docker-compose.dev.yml         adds a self-hosted PostgreSQL
├── .dockerignore                  build context = repo root (npm workspaces)
├── .gitattributes                 forces LF for shell scripts (CRLF breaks exec)
├── .env.example                   deployment template for docker compose
└── package.json                   npm workspaces + convenience scripts
```

---

## Database schema overview

31 models. Highlights:

| Model | Purpose |
|---|---|
| `User`, `Wallet` | identity + point balances (`availableBalance`, `lockedBalance`) |
| `Course`, `CourseCommitmentOption` | catalogue and accelerated-deadline options |
| `Module`, `ModuleContent` | ordered curriculum; content typed VIDEO/READING/QUIZ/MODULE_ASSESSMENT/CODING/SUBJECTIVE |
| `Quiz`, `QuizQuestion`, `QuizOption` | module quizzes |
| `Assessment`, `AssessmentQuestion`, `AssessmentOption` | module assessments and the final test |
| `Enrollment`, `CourseAttempt` | one enrolment per learner/course; one row per attempt |
| `ContentProgress` | verified watch segments, reading state, completion |
| `QuizAttempt`, `AssessmentSubmission` | graded attempts with scores and review state |
| `Stake` | locked/returned/forfeited points per attempt |
| `WalletTransaction` | append-only point ledger with `balanceAfter` |
| `RewardPool`, `RewardPoolTransaction` | forfeiture sink and its own ledger |
| `CourseReview`, `InstructorBadge`, `Notification` | ratings, reputation, in-app events |
| `ReadingSection`, `ReadingResource` | ordered sections of a structured reading lesson + attached PDFs/links |
| `ReadingCheckpoint`, `ReadingCheckpointQuestion`, `ReadingCheckpointOption` | per-section knowledge checks with answer keys |
| `ReadingSectionProgress`, `ReadingCheckpointSubmission` | per-attempt section completion, attempt counts, graded submissions |

Enums: `Role`, `CourseStatus`, `Difficulty`, `ContentType`, `ContentStatus`,
`EnrollmentStatus`, `AttemptStatus`, `StakeType`, `StakeStatus`, `WalletTransactionType`,
`RewardPoolTransactionType`, `AssessmentType`, `QuestionType`, `AttemptGradeStatus`,
`BadgeTier`, `NotificationType`, `ReadingResourceKind`.

---

## Environment variables

Copy `.env.example` → `.env` (root, for compose) and
`backend/.env.example` → `backend/.env` plus `frontend/.env.example` → `frontend/.env`.

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` | backend | PostgreSQL connection string (Supabase pooler works) |
| `TEST_DATABASE_URL` | backend | optional, used by the integration suite |
| `AUTH_PROVIDER` | backend | `local` or `supabase` |
| `JWT_SECRET` | backend | ≥ 16 chars, required when `AUTH_PROVIDER=local` |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | backend | required when `AUTH_PROVIDER=supabase` |
| `SUPABASE_SERVICE_ROLE_KEY` | backend | **server only — never ship to the browser** |
| `SUPABASE_JWT_SECRET` | backend | only if the project signs JWTs with a shared secret |
| `CORS_ORIGIN` | backend | comma-separated allow-list |
| `SIGNUP_WALLET_GRANT` | backend | welcome points (default 1500) |
| `AT_RISK_THRESHOLD_PERCENT` | backend | pacing gap that flags AT_RISK (default 15) |
| `SCHEDULER_ENABLED` | backend | `false` disables cron (tests do this) |
| `SUPABASE_STORAGE_BUCKET` | backend | private bucket for reading PDFs (default `course-assets`) |
| `READING_PDF_MAX_MB` | backend | max accepted PDF size (default `10`) |
| `READING_SIGNED_URL_TTL_SECONDS` | backend | signed-URL lifetime for private PDFs (default `900`) |
| `AI_PROVIDER` | backend | `openai` \| `gemini` \| `anthropic` \| `compatible`; unset = AI off |
| `AI_API_KEY` | backend | provider key; empty disables every AI endpoint |
| `AI_MODEL` | backend | model id; defaults per provider |
| `AI_BASE_URL` | backend | override for OpenAI-compatible endpoints |
| `AI_MAX_OUTPUT_TOKENS` / `AI_TIMEOUT_MS` | backend | per-call budget (defaults `3000` / `30000`) |
| `EMAIL_ENABLED` | backend | `true` turns transactional email on; anything else = off |
| `EMAIL_PROVIDER` | backend | `resend` (needs a verified domain) or `smtp` (sends through a real mailbox) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | backend | SMTP server; defaults `smtp.gmail.com:465`, secure `true` |
| `SMTP_USER` / `SMTP_PASS` | backend | mailbox credentials — Gmail needs an **App Password**, not the account password |
| `RESEND_API_KEY` | backend | Resend key; empty disables sending (resend transport only) |
| `EMAIL_FROM` | backend | sender on a Resend-verified domain |
| `EMAIL_REPLY_TO` | backend | optional reply-to |
| `EMAIL_TIMEOUT_MS` | backend | per-send timeout (default `15000`) |
| `APP_URL` | backend | public origin used in email links |
| `VITE_API_URL` | frontend | API base URL baked into the bundle |

No secrets are committed. `.env` files are gitignored; only `.env.example` ships.

---

## Local setup

```bash
# 1. Install (npm workspaces installs backend + frontend)
npm install

# 2. Configure
cp .env.example .env
cp backend/.env.example backend/.env      # set DATABASE_URL
cp frontend/.env.example frontend/.env

# 3. Database
npm run db:generate
npm run db:migrate        # first time: creates the migration + applies it
npm run db:seed

# 4. Run both apps
npm run dev               # API :4000, web :5173
```

API health: <http://localhost:4000/api/health>
Web app: <http://localhost:5173>

---

## Supabase setup

`AUTH_PROVIDER=local` is the default and needs no external service. To use Supabase Auth:

1. Create a Supabase project.
2. **Database** → copy the pooled connection string into `DATABASE_URL`, and the direct
   connection into a variable you use for migrations:
   ```bash
   DATABASE_URL="<direct-url>" npm run db:deploy
   ```
3. **Settings → API** → copy `Project URL` and `anon` key into `SUPABASE_URL` /
   `SUPABASE_ANON_KEY`. Keep `service_role` on the server only.
4. If the project signs JWTs with a shared secret (HS256), set `SUPABASE_JWT_SECRET`.
   With asymmetric keys the API verifies against the project JWKS automatically.
5. Set `AUTH_PROVIDER=supabase` and restart the API.

Flow with Supabase enabled: credentials are created and verified by Supabase GoTrue; the API
then maps the Supabase subject id to a local profile. Roles, stakes and all business rules
stay in this database — Supabase never decides authorisation.

### Connection shape: direct vs pooled (read this if connection attempts fail)

Supabase exposes two connection endpoints, and the difference matters:

| Endpoint | Host | Notes |
|---|---|---|
| Direct | `db.<project-ref>.supabase.co:5432` | **IPv6-only on most plans.** Also has an A record, but on an IPv4-only host that address does not respond. |
| Pooled (Supavisor) | `aws-0-<region>.pooler.supabase.com:6543` | IPv4 + IPv6, transaction pooling. Recommended for a deployed API. Add `?pgbouncer=true&connection_limit=1`. |

Observed failure mode on an IPv4-only host using the **direct** host: Prisma's query engine
resolves the (unreachable) IPv4 address and every connection dies after the 5 s connect
timeout with `P1001: Can't reach database server`. It can look intermittent, because the
answer depends on which address the resolver returns first — and the symptom (requests that
hang or fail at random) looks nothing like a DNS problem.

If you see that, switch `DATABASE_URL` to the pooled host and run migrations against the
direct URL:

```bash
cd backend
npx prisma migrate deploy      # with DATABASE_URL set to the direct/session URL
```

Do **not** put the raw IPv6 literal in `DATABASE_URL` as a workaround: TLS still needs a
hostname for SNI, and Prisma fails with a Schannel error
(`No credentials are available in the security package`) on Windows.

For richer demo content you can push the schema without migration files:

```bash
cd backend && npx prisma db push && npm run db:seed
```

---

## Prisma commands

```bash
npm run db:generate   # regenerate the client after a schema change
npm run db:migrate    # create + apply a migration in development
npm run db:deploy     # apply existing migrations (CI / production)
npm run db:seed       # reset-dependent demo data
npm run db:reset      # drop, re-migrate and re-seed
npm run db:studio     # Prisma Studio
```

Note: `db:seed` is safe to re-run — it clears the demo dataset first.

---

## Reading lessons (MOOC reader)

Reading content exists in two shapes, and both are supported by the same API:

| Shape | Data | Completion rule |
|---|---|---|
| **Structured** (new) | ordered `ReadingSection` rows + optional checkpoints + attached PDFs/links | every section complete; checkpoint sections require a passed check |
| **Legacy** | a single `ModuleContent.readingBody` string | scroll to the end (+ comprehension check if configured) |

A legacy reading keeps working untouched — it is treated as published. A structured
lesson is a **draft** until `readingPublishedAt` is set, and learners receive
`422 CONTENT_LOCKED { reason: "NOT_PUBLISHED" }` while it stays a draft.

### How progression is enforced

Scrolling never completes a structured lesson. The server derives everything from
`ReadingSectionProgress`:

1. Section *N* is readable only when sections *1…N-1* are complete
   (`computeSectionUnlocks` in `src/lib/reading.ts`).
2. A section with a checkpoint completes **only** when the checkpoint is passed.
   Marking it read returns `422 CHECKPOINT_REQUIRED`.
3. A section without a checkpoint completes on an explicit "mark as read" call.
4. `POST /attempts/:id/content/:id/complete` re-checks the whole lesson and refuses
   with `422 INVALID_PROGRESS` while anything is outstanding.
5. Progress rows are unique per `(attemptId, sectionId)`, so a repeated call cannot
   create a second completion. Checkpoint submissions are unique per
   `(checkpointId, attemptId, attemptNumber)`, and `maxAttempts` is enforced.
6. Editing published content never deletes progress: completion is never downgraded,
   and the lesson version is bumped so `readingCompletedVersion` records what the
   learner actually completed.

### Private PDF storage (Supabase Storage)

Reading PDFs are private course content. The API uploads with the **service-role
key** (server-side only) and hands the browser a short-lived signed URL — no storage
credential ever reaches the client.

```bash
# 1. Create a PRIVATE bucket (no public read policy) in Supabase → Storage
#    name it whatever you set in SUPABASE_STORAGE_BUCKET (default: course-assets)
# 2. Point the API at it
#    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET
#    READING_PDF_MAX_MB=10
#    READING_SIGNED_URL_TTL_SECONDS=900
```

Uploads are `POST /api/content/:contentId/reading/resources/upload` with the raw PDF
as the request body (`Content-Type: application/pdf`, display name in `x-file-name`).
Validation happens before anything is stored: declared type, size limit, `%PDF-`
magic bytes and the `%%EOF` trailer. Storage paths are generated server-side
(`courses/<courseId>/reading/<contentId>/<uuid>.pdf`), so a file name can never
influence the object key.

When storage is unconfigured, the lesson still loads and PDF rows report
`available: false`; uploads return `503 STORAGE_NOT_CONFIGURED`.

### Database migration

The reading feature ships as one **additive** migration (new tables, new nullable
or defaulted columns — no data is rewritten):

```bash
cd backend
npx prisma migrate deploy     # apply 20251026120000_structured_reading_lessons
npx prisma generate           # regenerate the client
```

**Pooler caveat (verified against this project's Supabase instance):** `prisma migrate`
commands hang indefinitely when `DATABASE_URL` points at the transaction pooler
(`...pooler.supabase.com:6543`). The query engine works fine over that port — only the
migration engine does not. Run migrations against the **direct** connection
(`db.<project-ref>.supabase.co:5432`) or the session pooler (`:5432`).

If you only have the pooler URL to hand, `backend/scripts/apply-reading-migration.js`
applies this migration through the query engine and records it in `_prisma_migrations`
with the correct checksum, so a later `migrate deploy` treats it as already applied:

```bash
cd backend
node scripts/apply-reading-migration.js   # idempotent; prints the tables it created
```

To confirm the bucket is wired correctly before trusting the upload UI, run the storage
round-trip probe — it uploads a tiny PDF, mints a signed URL, fetches it, deletes it and
checks the signature is revoked:

```bash
cd backend
node scripts/storage-probe.js
# upload=ok … signed_fetch_status=200 bytes=118 matches=true … delete=ok
# signed_url_after_delete_status=400 (proves the bucket is private)
```

If you prefer schema push on a disposable database: `npx prisma db push`.

### Reading API

| Method | Path | Who |
|---|---|---|
| `GET` | `/api/content/:contentId/reading` | instructor/admin — full draft incl. answer keys |
| `PUT` | `/api/content/:contentId/reading` | lesson description, objectives, references |
| `POST` | `/api/content/:contentId/reading/sections` | add section |
| `PUT` / `DELETE` | `/api/content/:contentId/reading/sections/:sectionId` | edit / remove |
| `PATCH` | `/api/content/:contentId/reading/sections/reorder` | reorder (`orderedIds`) |
| `PUT` / `DELETE` | `/api/content/:contentId/reading/sections/:sectionId/checkpoint` | upsert / remove |
| `POST` | `/api/content/:contentId/reading/publish` · `/unpublish` | publication gate |
| `GET` | `/api/content/:contentId/reading/preview` | instructor preview + publish checklist |
| `POST` | `/api/content/:contentId/reading/resources` | attach link/embed (http/https only) |
| `POST` | `/api/content/:contentId/reading/resources/upload` | raw PDF upload |
| `DELETE` | `/api/content/:contentId/reading/resources/:resourceId` | detach (removes the object) |
| `POST` | `/api/attempts/:attemptId/content/:contentId/reading/position` | learner — resume pointer |
| `POST` | `/api/attempts/:attemptId/content/:contentId/reading/sections/:sectionId/complete` | mark read |
| `POST` | `/api/attempts/:attemptId/content/:contentId/reading/checkpoints/:checkpointId/submit` | grade + unlock |
| `GET` | `/api/attempts/:attemptId/content/:contentId/reading/resources/:resourceId/url` | signed URL |

Section HTML is sanitised **server-side on write** with a tag/attribute allow-list
(`src/lib/richText.ts`): no `<script>`, `<iframe>`, event handlers, inline styles,
`javascript:` or `data:` URLs. The reader renders only that sanitised HTML.

### Frontend surfaces

| Screen | Route |
|---|---|
| Reader (TOC, text size, checkpoints, PDF viewer, resume) | `/learn/:enrollmentId/content/:contentId` |
| Lesson editor (sections, checkpoints, resources, publish) | `/instructor/courses/:courseId/reading/:contentId` |
| Same editor for administrators | `/admin/courses/:courseId/reading/:contentId` |

The reader saves position on every section change and on a 30-second heartbeat, so
"Continue reading" resumes the same section and PDF page after a refresh, a logout
or on another device.

---

## Docker

Container files:

| File | Purpose |
|---|---|
| `docker-compose.yml` | Production-oriented stack: **api** + **web** only. The database is managed (Supabase), so no database container runs. |
| `docker-compose.dev.yml` | Fully local stack: adds a self-hosted PostgreSQL 16 with a named volume. |
| `backend/Dockerfile` | Multi-stage API image (deps → tsc → non-root runtime). |
| `backend/docker-entrypoint.sh` | Applies Prisma migrations with retries, then starts the server. |
| `frontend/Dockerfile` | Builds the SPA, serves it with nginx. |
| `frontend/nginx.conf` | SPA fallback routing, asset caching, `/api` proxy, security headers. |
| `.dockerignore` | Build context is the **repository root** (npm workspaces need the root lockfile). |

### Managed database (Supabase) — default

```bash
cp .env.example .env          # set DATABASE_URL, JWT_SECRET, SUPABASE_* 
docker compose build
docker compose up -d
docker compose logs -f api
docker compose down
```

Exposed: the SPA on <http://localhost:8080> and the API on
<http://127.0.0.1:4000> (loopback only in this stack). nginx proxies `/api` to the
`api` service, so the browser only ever talks to one origin and no CORS entry is
needed.

### Fully local stack (self-hosted PostgreSQL)

```bash
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml exec api npm run db:push
docker compose -f docker-compose.dev.yml exec api npm run db:seed
```

`db:push` creates the schema in the fresh volume; `db:seed` fills it with the demo
dataset. The seed resets first, so it is safe to re-run.

Use the root `npm run db:push` / `npm run db:seed` scripts rather than calling
`npx prisma` directly. The Prisma CLI is installed in `backend/node_modules/.bin`
and is **not** on `PATH` at the repository root, so a bare `npx prisma db push`
fails with `sh: prisma: not found`. The root scripts delegate to the backend
workspace, which is where both the CLI and `prisma/schema.prisma` live.

The dev compose overrides `DATABASE_URL`, `AUTH_PROVIDER=local` and `CORS_ORIGIN`,
so it works with no external service. It publishes **different host ports** from
the production stack, so the two can run at the same time — useful when the
managed database is unreachable:

| Stack | Web | API | Database |
| --- | --- | --- | --- |
| `docker compose up` | <http://localhost:8080> | <http://127.0.0.1:4000> | Supabase (from `.env`) |
| `docker-compose.dev.yml` | <http://localhost:8090> | <http://localhost:4100> | bundled PostgreSQL on **5433** |

The dev stack reads `DEV_WEB_PORT` / `DEV_API_PORT`; `WEB_PORT` / `API_PORT` in
`.env` belong to the production stack. Port **5433** avoids clashing with a native
PostgreSQL on 5432, and each file declares its own Compose project name
(`stakeit-prod` / `stakeit-dev`) so their containers and networks never interfere.

### Request path

```text
Browser ──▶ web (nginx :80 → host :8080)
                │  GET /            → SPA (index.html, React Router)
                │  GET /api/*       → proxy_pass http://api:4000
                ▼
            api (Express :4000) ──▶ Supabase PostgreSQL
```

`VITE_API_URL` is a **build argument**, not a runtime variable — Vite inlines it
into the bundle. To point the SPA at a different API origin you must rebuild the
image (`--build-arg VITE_API_URL=...`) and add that origin to `CORS_ORIGIN`.

### Health checks

```text
GET /api/health
  200 { "data": { "status": "ok",       "database": "up",   "uptimeSeconds": …, "timestamp": … } }
  503 { "data": { "status": "degraded", "database": "down", "uptimeSeconds": …, "timestamp": … } }
```

The probe issues a single `SELECT 1` — cheap enough to run on every interval, and
it distinguishes "process alive but database unreachable" from a healthy service.
It returns no configuration, credentials or secrets. Both images declare
`HEALTHCHECK`s (`curl` for the API, `wget` for nginx).

Note that Docker does **not** restart a container merely because it reports
`unhealthy`; the 503 surfaces the problem through `docker ps` and your monitoring
without turning a database outage into a restart loop.

---

## Database initialisation (deployment safety)

Two supported workflows — pick one and stay consistent.

**A. Migrations (recommended, and required for tracked schema history)**

```bash
cd backend
DATABASE_URL="<direct-connection-string>" npx prisma migrate deploy
```

`migrate deploy` is non-destructive: it only applies migrations that have not
run yet. The API container runs it on start (disable with
`RUN_MIGRATIONS_ON_START=false`).

**B. Schema push (development / first-time setup on a throwaway database)**

```bash
cd backend
npx prisma db push          # creates the schema without migration files
npm run db:seed
```

> `prisma migrate reset` and `prisma db push --force-reset` **drop all data**.
> Never run them against a database you care about. They are not part of any
> documented deployment path.

If you connect through a pooler, run migrations against the direct (non-pooled)
URL; see `backend/.env.example` and the `directUrl` note in
`prisma/schema.prisma`.

---

## Production checklist

| Concern | Guidance |
|---|---|
| Frontend URL | The public origin users visit, e.g. `https://stake-it.example.com`. Terminate TLS at your ingress/load balancer. |
| Backend URL | Either the same origin (`/api` proxied by nginx) or a dedicated host; if separate, set `VITE_API_URL` at build time. |
| CORS | Set `CORS_ORIGIN` to the exact frontend origin(s). The API **refuses to boot** in production if it contains `*`. |
| `JWT_SECRET` | Must not be the development placeholder and must be ≥ 32 characters; enforced at boot when `AUTH_PROVIDER=local`. |
| Supabase keys | `SUPABASE_URL` plus `SUPABASE_ANON_KEY` or `SUPABASE_JWT_SECRET` are required when `AUTH_PROVIDER=supabase`. `SUPABASE_SERVICE_ROLE_KEY` stays server-side and is never sent to the browser. |
| `TRUST_PROXY` | Set to the number of proxy hops in front of the API (1 behind nginx) so rate limiting sees real client IPs. |
| Secrets | Live only in `.env` (gitignored) or your platform's secret store. Nothing secret is ever committed, logged, or bundled into the frontend. |
| Logs | Pino JSON to stdout — collect with your platform's log driver. Tokens, cookies and database URLs are redacted. |
| Restart behaviour | `restart: unless-stopped`. The entrypoint retries migrations with backoff before failing. |
| Scheduler | The deadline/at-risk cron jobs run **inside the API process**. Run a single API replica, or set `SCHEDULER_ENABLED=false` on all but one if you scale out. |
| Database reachability | Supabase direct connections are IPv6-only on many plans. From an IPv4-only host use the Supavisor pooler string (see `backend/.env.example`). |

---
---

## API overview

| Group | Endpoints |
|---|---|
| Auth | `POST /api/auth/register`, `/login`, `/logout`, `GET|PATCH /api/auth/profile`, `POST /api/auth/change-password` |
| Catalogue | `GET /api/courses`, `/courses/facets`, `/courses/:id`, `/courses/:id/reviews` |
| Authoring | `POST /api/courses`, `PUT|DELETE /api/courses/:id`, `POST /api/courses/:id/publish|unpublish|archive` |
| Curriculum | `GET|POST /api/courses/:id/modules`, `PATCH /api/courses/:id/modules/reorder`, `PUT /api/modules/:id`, `POST /api/modules/:id/content`, `PUT /api/content/:id`, `PUT /api/quizzes/:id/questions`, `PUT /api/assessments/:id/questions`, `PUT /api/courses/:id/commitment-options`, `POST /api/courses/:id/final-assessment` |
| Enrolment | `POST /api/courses/:id/enroll`, `GET /api/enrollments`, `/enrollments/:id`, `POST /api/enrollments/:id/retry|withdraw` |
| Learning | `GET /api/enrollments/:id/learning-state`, `GET /api/attempts/:id/content/:contentId`, `POST …/progress`, `…/complete`, `…/comprehension`, `GET /api/attempts/:id/pacing` |
| Reading lessons | `GET|PUT /api/content/:id/reading`, `POST|PUT|DELETE /api/content/:id/reading/sections[/:sectionId]`, `PATCH …/sections/reorder`, `PUT|DELETE …/sections/:sectionId/checkpoint`, `POST …/reading/publish|unpublish`, `GET …/reading/preview`, `POST …/reading/resources[/upload]`, `DELETE …/resources/:resourceId` |
| Reading progress | `POST /api/attempts/:id/content/:contentId/reading/position`, `…/sections/:sectionId/complete`, `…/checkpoints/:checkpointId/submit`, `GET …/resources/:resourceId/url` |
| Quizzes | `GET /api/attempts/:id/quizzes/:quizId`, `POST …/attempt`, `GET …/results` |
| Assessments | `GET /api/attempts/:id/assessments/:id`, `POST …/submit`, `GET …/results` |
| Settlement | `GET /api/attempts/:id/settlement`, `/settlement/preview` |
| Stakes | `GET /api/stakes`, `/stakes/summary`, `/stakes/:id` |
| Wallet | `GET /api/wallet`, `/wallet/transactions`, `/wallet/insights` |
| Rewards | `GET /api/rewards`, `/rewards/pool` |
| Analytics | `GET /api/dashboard`, `/my-courses`, `/instructor/dashboard`, `/instructor/courses`, `/courses/:id/analytics` |
| Admin | `GET /api/admin/dashboard`, `/admin/users`, `/admin/courses`, `/admin/instructors`, `/admin/reviews`, `/admin/reward-pool`, `/admin/badges`, `/admin/transactions`, `POST /api/admin/deadline-engine/run` |
| Notifications | `GET /api/notifications`, `/unread-count`, `POST /notifications/:id/read`, `/read-all` |
| Health | `GET /api/health` |

Every response is `{ "data": … }`; errors are
`{ "error": { "code", "message", "details?", "requestId" } }`.

Spec-style aliases are also mounted: `GET /api/modules/:id?attemptId=…` and
`GET|POST /api/content/:id?attemptId=…`.

---

## User roles

`LEARNER`, `INSTRUCTOR`, `ADMIN`. Only learner and instructor are self-registerable; an admin
can promote accounts. Authorisation is resolved from the database on every request — never
from a token claim or a client-supplied value.

---

## Business rules

The complete, authoritative list is in **[docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md)**.
The non-negotiables:

1. Virtual points only — no money, no wagering.
2. Sequential progression enforced server-side.
3. Completion verified server-side (video watch segments, reading end point, graded
   instruments) — not by a "mark complete" button. For a structured reading lesson the
   end point is *every section complete*, with checkpoint sections requiring a pass; a
   scroll position is never accepted as proof.
4. Final test locked until every required module is complete.
5. Instructor weights must total exactly 100%.
6. Final score = module × moduleWeight + finalTest × finalTestWeight.
7. Performance bonus depends on the configured final-score threshold.
8. Missing the normal deadline fails the attempt and forfeits the base stake.
9. Missing the *accelerated* deadline does **not** fail the course — only the bonus is lost.
10. Forfeited points go to the reward pool, never to another learner.
11. Retry requires no new mandatory stake; recovery reward = original stake ÷ attempt number.
12. Every point movement has a ledger entry; staking and settlement are transactional.
13. Reputation requires a minimum sample size.
14. Recommendations are advisory, never forced.
15. No invasive learner surveillance.

---

## Testing

```bash
npm run test:unit          # pure business logic — no database required
npm run test:integration   # real API against a real database
npm test                   # both
```

Unit tests cover the arithmetic the reward economy depends on: grading, valid-watch
tolerance, segment merging, scrub rejection, sequential unlocking, pacing/at-risk, weighted
scoring, weight validation, retry recovery, performance bonus and reputation gating.

> **The integration suite is destructive.** `resetDatabase()` runs
> `TRUNCATE … CASCADE` over every table on each test, so it deletes all rows in whatever
> database `DATABASE_URL` points at — users, courses, wallets, everything. Always run it
> against a **throwaway database**, never your working one. The suite refuses to start
> unless you opt in explicitly:
>
> ```bash
> # bash
> INTEGRATION_TEST_DB_CONFIRM=1 npm run test:integration
> # PowerShell
> $env:INTEGRATION_TEST_DB_CONFIRM='1'; npm run test:integration
> ```
>
> Without that variable every database-backed test skips and prints the reason.

Integration tests drive the real Express app against a real PostgreSQL database — no mocked
services — and assert staking, insufficient balance, sequential locking, scrub rejection,
full happy-path settlement, below-threshold bonus suppression, forfeiture, retry recovery,
attempt limits, RBAC and concurrent-stake safety.

The reading suite (`tests/integration/readingLesson.test.ts`) covers the MOOC reader
specifically: draft lessons invisible to learners, learner access denied on authoring
routes, in-order section unlocking, `CHECKPOINT_REQUIRED` for guarded sections, wrong-then-correct
checkpoint answers, refusal to complete with sections outstanding, single completion record on
double-complete, resume position across requests, cross-learner attempt rejection, progress kept
after a published edit, and the publish gate plus HTML sanitisation.

`tests/unit/readingLesson.test.ts` covers the same rules without a database: section-unlock
walks, completion maths, checkpoint grading (including multi-choice set equality), authoring
validation, the rich-text allow-list, and external-URL rejection of `javascript:`/`data:`.

**If no database is reachable the integration suite reports as SKIPPED, never as passed**, so
a green run cannot overstate coverage.

### Performance of the integration suite

The suite is written to minimise database round-trips, because it is often pointed at a
*remote* database. Measured against a Supabase instance ~200 ms from the test runner:

| Metric | Value |
|---|---|
| Single SQL statement | ~210 ms |
| SQL statements per API request | 16–24 |
| Wall time for one end-to-end test | 30–60 s |
| Fixture cost | `resetDatabase` is **one** `TRUNCATE … CASCADE`; `createMinimalCourse` is **two** round-trips (nested creates + one batched transaction) |

Because a single test legitimately needs 30–60 s on a remote database, the integration
suite declares its own per-test budget (`INTEGRATION_TEST_TIMEOUT_MS` in
`tests/integration/helpers.ts`). Unit tests keep the default 30 s. This is a latency
allowance, not a way to hide failures: a genuine logic error still fails, and the unit
suite covers the same rules with no database at all.

Running against a **local** PostgreSQL removes both the latency and the flakiness, and is the
recommended way to run the suite (14 s instead of ~8.6 min):

> Point the suite at a local database wherever you can. Against a remote host, a dropped
> connection surfaces as a `500` on the heaviest test (the settlement submit) or as a timeout on
> the next-heaviest — failures that say nothing about the application logic and pass consistently
> the moment the database is reachable. See `docs/PROJECT_STATUS.md` §2.1 for the measured
> evidence.

```bash
# local database, a few seconds per test instead of a minute
TEST_DATABASE_URL="postgresql://stakeit:stakeit@localhost:5432/stakeit_test?schema=public" \
  npm run test:integration
```

### Known N+1 access patterns

`PRISMA_LOG_QUERIES=true` logs every SQL statement Prisma executes (never enabled in
production), which is how the counts above were measured. The hot path
(`loadAttempt` in `learningService`, used by every learning request) loads a deep include
tree — enrolments, attempts, modules, contents, quizzes, assessments, progress, submissions
and stakes — and Prisma issues one statement per relation, giving the 16–24 statements per
request. The queries are all index-backed and the volume is bounded; consolidating them
would mean flattening that tree with raw SQL, which was judged a larger risk than the
latency it removes. Recorded here so the trade-off is explicit rather than accidental.

---

## Future enhancements

The architecture leaves explicit seams for:

- **Coding evaluation** — `CODING` questions are stored and marked `PENDING_REVIEW`; a
  sandbox runner that executes against test cases can grade them without schema changes.
- **AI rubric + human review** — same seam for `SUBJECTIVE`; `AssessmentService.manualReview`
  already accepts a score, notes and a reviewer.
- **ML stake recommendation** — implement `StakeRecommender` and register it with
  `setRecommender`; nothing else changes.
- **Email/push notifications** — persistence is already decoupled from emission.
- **Object storage for course assets** — `courseAssetPublicUrl` is wired for Supabase
  Storage; instructors currently supply a URL.

---

## Design provenance

The visual language is taken from the supplied Stitch design screens (learner dashboard,
course page, video, quiz, completion summary, enrolment, course builder). Their Tailwind
design tokens were transcribed verbatim into `frontend/tailwind.config.js` — near-white
surfaces, indigo accent, hairline borders, no decorative shadow.

Note: the original brief described a "dark dashboard with an orange accent". The supplied
screens are light with an indigo accent and are treated as the source of truth. Switching
themes is a token change in that one file.

---

## Certificates

A learner who finishes a course can download a PDF certificate; anyone can verify one by code
without an account.

- **No storage.** The PDF is rendered per download from the `certificates` row (`pdf-lib`), so
  there are no orphaned files and revocation takes effect immediately.
- **Eligibility is server-side.** Issuing is refused with `422 INVALID_PROGRESS` unless the
  attempt is `COMPLETED`, and `403` for an attempt that is not the caller's. There is no client
  path to a certificate.
- **Idempotent.** `certificates.attempt_id` is unique — a double-click or replay returns the same
  code instead of minting a second certificate.
- **Snapshot.** Learner name and course title are copied at issue time, so renaming a course later
  does not rewrite an issued document.
- **Verification** is public at `/verify/:code` and `GET /api/certificates/verify/:code`,
  rate limited to 60/hour to make code guessing impractical. It exposes only what is printed on
  the certificate.
- **Revocation** is admin-only: `POST /api/certificates/:code/revoke { reason }`. A revoked
  certificate stops downloading and verifies as invalid with the reason shown.

Set `CERTIFICATE_ISSUER` (default `Stake It Academy`) for the issuing body printed on the document;
`APP_URL` is used in the verification line at the foot of the PDF.
