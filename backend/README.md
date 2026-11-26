# Brand Intelligence — backend (Node.js)

API and background workers for the Brand Intelligence platform. A standalone project: it has its own
dependencies, `.env`, Docker setup and tests, and deploys independently of `../frontend`.

**API reference:** [`docs/API.md`](docs/API.md) — every endpoint with purpose, fields, rules, errors and examples.
Interactive version at `http://localhost:8020/docs`. Folder-by-folder guide: [`ARCHITECTURE.md`](ARCHITECTURE.md).

The legacy Python backend lives read-only in `../legacy/python-backend/`. Its behaviour, down to scoring weights
and table columns, is documented in `../docs/port/PYTHON-BACKEND-REFERENCE.md` — port features from there.

## Quick start

```bash
cp .env.example .env          # local defaults work as-is; add APIFY_TOKEN to use Apify
npm install
npm run services:up           # Postgres :5433 + Redis :6380 + S3 storage :9100 (console :9101) in Docker
npm run db:migrate            # create tables + first admin (admin@example.com / ChangeMe!2026)
npm run dev                   # API on http://localhost:8020  (docs: /docs)
npm run dev:worker            # background workers, in a second terminal
npm test
```

| Command | What it does |
|---|---|
| `npm run dev` / `dev:worker` | API / workers with auto-reload |
| `npm run build` → `start` / `start:worker` | compiled production run |
| `npm run db:generate -- --name <change>` | write a SQL migration from schema changes |
| `npm run db:migrate` | apply migrations, ensure bootstrap admin |
| `npm run db:studio` | browse the database in the browser |
| `npm run typecheck` / `lint` / `test` | checks |
| `docker compose --profile app up -d --build` | API + worker + migration in containers |

## Stack and why

| Piece | Choice | Why, for a large-scale system |
|---|---|---|
| Runtime | Node.js 24 + TypeScript (strict) | Types catch mistakes across a big codebase; one language with the frontend. |
| HTTP | **Fastify** | One of the fastest Node frameworks; validates every request/response against a schema; plugin system keeps features isolated. |
| Validation / contracts | **zod** DTOs (`fastify-type-provider-zod`) | One definition gives runtime validation, TypeScript types and the OpenAPI docs at `/docs`. |
| Database | **PostgreSQL 17** via **Drizzle ORM** | SQL-first and light, typed queries, plain SQL migrations you can review. |
| Read scaling | `db` (primary) and `dbRead` (replica) | Heavy lists/stats/exports go to a read replica by setting `DATABASE_READ_URL`, with no code change. |
| IDs | **UUIDv7** | Unique like UUIDv4 but time-ordered, so inserts stay fast and indexes compact at millions of rows. |
| Cache | **Redis** (`infra/cache.ts`) | Read-through cache with stampede protection and group invalidation; Redis being down never breaks a request. |
| Jobs | **BullMQ** on Redis (replaces Celery + beat) | Retries with backoff, scheduling, separate queues (`default`, `browser`, `system`) that scale on different machines. |
| Auth | argon2id passwords + HS256 JWT (`fast-jwt`) | Same parameters as legacy, so existing password hashes keep working. |
| Rate limiting | `@fastify/rate-limit` counted in Redis | The limit holds across every API instance; login has its own tighter limit. |
| Logs | **pino** JSON, request id on every line | Fast structured logs; secrets redacted. |
| Shutdown | `close-with-grace` | On deploy, finishes in-flight requests and running jobs before exiting. |
| Config | `config/env.ts` (zod) | Every setting validated at startup; refuses to start in production with default secrets. |

**Scaling model:** the API is stateless — run as many copies as traffic needs. Workers are separate processes;
add more for more scan throughput, and pin heavy queues to bigger machines with `WORKER_QUEUES=browser`.
Postgres connections = processes × `DB_POOL_MAX`; put PgBouncer in front when that gets large.

## Architecture: layers (like Controller / Service / Repository in Spring)

```
request → routes (+ guard) → controller → service → repository → Postgres
                                             ↘ integrations (Apify, …), cache (Redis), queues (BullMQ)
background job → <feature>.jobs.ts → service → repository
```

| Layer | File | Does | Never does |
|---|---|---|---|
| Routes | `<feature>.routes.ts` | Maps URL + method to a controller method; declares DTOs, docs tag, auth guard | Logic |
| Controller | `<feature>.controller.ts` | HTTP only: read the validated request, call the service, choose the status code | DB access, business rules |
| Service | `<feature>.service.ts` | Business logic, transactions, caching, enqueueing jobs, calling integrations | Touch `request`/`reply` |
| Repository | `<feature>.repository.ts` | Every database query for the feature (Drizzle) | Business rules, HTTP |
| DTO | `<feature>.dto.ts` | zod schemas for request and response bodies — the API contract | — |
| Mapper | `<feature>.mapper.ts` | Entity (DB row) → DTO (snake_case JSON); hides internal fields | Queries, logic |
| Jobs | `<feature>.jobs.ts` | Background job entry points: read `job.data`, call a service | Business logic |
| Guards | `auth/auth.guards.ts` | `preHandler: guards.user` / `guards.admin` on routes (like `@PreAuthorize`) | — |
| Integration | `integrations/<api>/` | Talks to one external API: HTTP calls, retries, caching of responses | Brand or business rules |

Wiring is explicit in **`src/container.ts`** (the composition root): it builds integrations, then repositories,
then services (with their repositories and integrations), then controllers — constructor injection, no globals.
Tests build the app with fakes: `buildApp(createContainer({ apifyClient: fake }))`.

### Folder layout

```
src/
  config/env.ts           all settings, validated (the only file that reads process.env)
  common/                 shared code used by many modules
    errors.ts               AppError → { "detail": ... } responses
    dto.ts                  pagination and query helpers
    scan-report.ts          per-source outcome of a scan + scan status rules
    brand-context.ts        brand snapshot for scans, search terms, date range
    social-handle.ts        account handle from a profile URL
    allowlist.ts            normalises official domains, packages, handles, certificates
    imaging.ts              image fingerprints (phash, dhash, favicon hash) and match score
  infra/                  db, redis, cache, queue, logger — technical plumbing
  integrations/           clients for external services, no business logic
    apify/                  apify.client (HTTP calls), apify.runner (parallel runs, cache, cost cap), apify.types
    storage/                object-storage.ts: S3-compatible file storage (put, delete, signed download links)
  db/schema/              tables and enums (entities); migrate.ts, bootstrap.ts
  modules/<feature>/      routes, controller, service, repository, dto, mapper, jobs
    auth/                   login, current user, route guards
    brands/                 brands, official images, allowlist (full API)
    users/ scans/           repositories shared by other modules (their own APIs come later)
    health/                 /health/live, /health/ready
    social-media/           social media monitoring (see below)
      sources/                adapters: turn each source's raw output into one SocialItem shape
        social-item.ts          the common item type
        apify/apify.sources.ts    every Apify search as data: actor, input, mapper
        apify/apify.collector.ts  runs the sources for a brand, reports each source's outcome
        apify/mappers/            one file per platform: instagram, tiktok, facebook, meta-ads, x, linkedin
  plugins/                Fastify plugins (error handler)
  workers/registry.ts     collects every module's job handlers and schedules
  container.ts            wires integrations → repositories → services → controllers
  app.ts                  builds the Fastify app (used by server.ts and tests)
  server.ts / worker.ts   process entry points
drizzle/                  generated SQL migrations (commit them)
test/                     tests (local Postgres + Redis; Apify is faked, so tests cost nothing)
```

### Adding a feature module (checklist)

1. Tables: add to `src/db/schema/`, then `npm run db:generate -- --name <change>` and review the SQL.
2. `modules/<feature>/`: `dto` → `repository` → `service` → `mapper` → `controller` → `routes` (copy `social-media`).
3. `container.ts`: construct the repository, service and controller.
4. `app.ts`: `api.register(<feature>Routes(controllers.<feature>, guards), { prefix: "/<feature>" })`.
5. Jobs (if any): `<feature>.jobs.ts`, add it to `workers/registry.ts`.
6. A new external API: its own folder under `integrations/`, injected into the service through the container.
7. Tests in `test/`.

### Conventions

- URLs and JSON fields keep the legacy API's names (`/api/v1/...`, `snake_case`, `{ items, total, page, page_size }`,
  errors as `{ "detail": ... }`), so the frontend works unchanged when it switches from dummy data.
- Throw `AppError` helpers (`notFound()`, `badRequest()`, …) from services; the error handler formats them.
- Lists are always paginated (`page_size` max 200). Big exports run as background jobs, not in a request.
- Every outbound HTTP call to untrusted URLs goes through a safe fetcher (to be ported — docs/port §5.1).

## Brands

A brand is what the platform protects: its names (keywords, product terms), its official images and its
allowlist of official domains, apps, publishers, social accounts, email domains and signing certificates.
Ported from legacy `api/brands.py`; same fields, rules and error messages.

| Endpoint (prefix `/api/v1/brands`) | Who | |
|---|---|---|
| `GET /`, `GET /:id` | signed in | brands by name, with images (signed download links) and allowlist |
| `POST /` | admin | create; 201, 409 duplicate name, 422 website address used as a keyword |
| `PATCH /:id` | admin | change only the fields sent |
| `DELETE /:id` | admin | delete with everything that belongs to it (scans, items, files) |
| `POST /:id/assets` | admin | upload official image: multipart `kind` (logo, favicon, app_icon) + `file`; ≤ 5 MB |
| `DELETE /:id/assets/:assetId` | admin | removes the record and the file |
| `GET /:id/allowlist` | signed in | |
| `POST /:id/allowlist`, `DELETE /:id/allowlist/:allowId` | admin | values normalised; 409 duplicate |

**Rules:** keywords and product terms are trimmed and de-duplicated, and must be words, not website addresses
(those go in the allowlist). No keywords → the brand name in lower case. Allowlist values are normalised, e.g.
`https://www.Example.com/` → `example.com`, a profile URL → `instagram.com/handle`.

**Images:** stored in S3-compatible storage (never in Postgres) with fingerprints used later to spot copies:
`phash` and `dhash` (perceptual hashes) and, for favicons, the Shodan-style `mmh3` hash. A re-encoded copy of the
test logo scores 93.75 against the original (match threshold 85); an unrelated image scores 68.
`open_alerts` is 0 until the alerts module is ported.

## Social media monitoring with Apify

Apify runs paid scrapers ("actors") for platforms without a usable official search API. Ported from the legacy
backend (`apify_sources.py`, `core/apify.py`) with the same actors, inputs and field mappings.

| Source (scan component) | Actor (env) | Searches |
|---|---|---|
| Apify Instagram | `APIFY_ACTOR_INSTAGRAM_POSTS` | posts for brand terms + scam queries (keyword mode) |
| Apify Instagram profiles | `APIFY_ACTOR_INSTAGRAM` | accounts named like the brand |
| Apify TikTok / TikTok profiles | `APIFY_ACTOR_TIKTOK` | videos / accounts |
| Apify Facebook posts | `APIFY_ACTOR_FACEBOOK` | latest posts for brand terms, top posts for scam queries |
| Apify Meta ads | `APIFY_ACTOR_META_ADS` | Meta Ad Library, per term × `META_AD_COUNTRIES` |
| Apify X | `APIFY_ACTOR_X` | posts without retweets, brand and scam windows |
| Apify LinkedIn | `APIFY_ACTOR_LINKEDIN` | posts, newest first |

**Flow:** `POST /api/v1/social-media/collections` records a scan run and queues a job (202, returns at once) →
the worker runs every enabled source, with all actor runs in parallel on Apify → items are normalised and
de-duplicated per brand (`social_items`: one row per item, `times_seen` counts repeats), the brand's own accounts
are marked official → every actor run is recorded with its cost (`apify_runs`) → the scan closes with a status per
source (ok / skipped / not configured / unavailable / failed), never a silent "nothing found".

| Endpoint (prefix `/api/v1/social-media`, signed in) | |
|---|---|
| `POST /collections` | start a collection: `brand_id`, optional `platforms`, `kinds` (content, profiles), `date_from`, `date_to` |
| `GET /collections`, `GET /collections/:id` | recent runs; one run with every Apify run and its cost |
| `POST /collections/:id/cancel` | stop a queued or running collection |
| `GET /items`, `GET /items/:id` | collected items; filter by brand, platform, content type, scan, text; paginated |
| `GET /apify/status` | token valid? which sources run, with which actor; current limits |
| `GET /apify/usage?days=30` | runs, cache hits, failures, items and USD per source |

**Cost control:** `APIFY_ITEMS_PER_QUERY` results per search, `APIFY_MAX_CHARGE_USD` hard cap per run,
`APIFY_RUN_TIMEOUT_SECONDS` (unfinished runs are aborted), identical searches served from Redis for
`APIFY_CACHE_MINUTES`, and collection jobs never auto-retry.

**Next:** analysis of `social_items` into scored findings and alerts (legacy `social_media/module.py`: scam contact
details, scam phrases, logo match, relevance) once the findings model is ported.

## Configuration

See `.env.example`; every variable is described in `src/config/env.ts`. Set `APIFY_TOKEN`
(console.apify.com → Settings → API & Integrations) to switch Apify on.

## Status

Done: project setup, config, Postgres + Redis + queues, layered structure, health checks, foundation tables,
bootstrap admin, auth (login / me / guards), brands API (image upload, fingerprints, allowlist, **search**,
**add details**), social media collection via Apify (8 sources, cost tracking), **phishing website search**
(look-alike generation, certificate logs, OpenPhish, DNS, website + email-record checks, one-off URL check),
**email security** (SPF/DMARC/DKIM/MTA-STS posture, suspicious .eml analysis), safe fetcher for all outbound HTTP.

Next: findings/alerts → screenshots + WHOIS for look-alikes → social media analysis → dashboard stats → users API →
apps / documents / logo modules. The full list of what is not ported yet is at the end of `docs/API.md`.
