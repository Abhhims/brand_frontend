# Backend Architecture Guide

This guide covers the Node.js backend (Fastify, Postgres, Redis, S3 storage and Apify): what each folder and file is for, and how a request moves through them.

The backend is a separate project from the frontend. It runs as two processes:

- **API server** (`src/server.ts`, port 8020): answers HTTP requests.
- **Worker** (`src/worker.ts`): runs long background jobs from Redis queues, such as Apify collections.

Every endpoint, with examples, is documented in **[docs/API.md](docs/API.md)** (and live at `/docs`).

It is organised like a Java/Spring project. Every feature has its own folder, split into the same layers.

---

## 1. How a request flows

```
HTTP request
   │
   ▼
routes      → which URL, who may call it, what the input/output looks like
   ▼
controller  → reads the request, calls the service, sends the response (no business rules)
   ▼
service     → the business rules (validation, decisions, calling other services)
   ▼
repository  → the only place that talks to the database
   ▼
Postgres / Redis / S3 storage / Apify
```

Long-running work does not run inside the HTTP request. The service puts a **job** on a Redis queue, and the API replies at once. The **worker** process then picks up the job and runs it.

---

## 2. Top-level files (`backend/`)

| File / folder | Use |
|---|---|
| `package.json` | Dependencies and commands: `npm run dev`, `dev:worker`, `test`, `db:migrate`, `services:up`, … |
| `.env` / `.env.example` | All configuration: database, Redis, storage, JWT, Apify keys. `.env` holds real secrets and is never committed; `.env.example` is the template. |
| `docker-compose.yml` | Starts Postgres (5433), Redis (6380) and file storage (9100, console 9101) locally. With the `app` profile it also runs the API and worker as containers. |
| `Dockerfile` | Builds the production image |
| `drizzle.config.ts` + `drizzle/` | Database migrations: versioned SQL files (`0000_init.sql`, `0001_social_media_apify.sql`) that create and change tables in order |
| `tsconfig*.json`, `eslint.config.js`, `vitest.config.ts` | TypeScript, lint and test settings |
| `README.md` | Developer guide: how to run, how to add a module |
| `ARCHITECTURE.md` | This file |

---

## 3. `src/`: the code

### 3.1 Entry points

| File | Use |
|---|---|
| `server.ts` | Starts the **API** on port 8020 and shuts it down cleanly |
| `worker.ts` | Starts the **background worker** that processes queued jobs |
| `app.ts` | Builds the web app. Adds security headers, CORS, rate limiting, file uploads and `/docs` (Swagger), and mounts every module's routes under `/api/v1`. |
| `container.ts` | The one place that creates every repository, service and controller and passes each its dependencies, like a Spring application context. You can see all the wiring here, and tests can swap in fakes such as a fake Apify. |

### 3.2 `config/`: settings

- **`env.ts`** reads `.env` and validates every value. If anything is wrong, the app stops at startup with a clear message.
- In production it also refuses default passwords and weak JWT secrets.
- **Rule:** no other file reads `process.env`. Everything imports `env` from here.

### 3.3 `infra/`: shared technical plumbing

| File | Use |
|---|---|
| `db.ts` | Postgres connection pool, plus an optional read-only replica (`dbRead`) for heavy reports |
| `redis.ts` | Redis connections |
| `cache.ts` | `cache.getOrSet()`: caches results in Redis. If many requests ask for the same value at once, only one computes it. |
| `queue.ts` | Job queues (BullMQ): `default`, `browser`, `system` |
| `logger.ts` | Structured JSON logging (pino), with readable output in development |

### 3.4 `common/`: helpers shared by several modules

| File | Use |
|---|---|
| `errors.ts` | `notFound()`, `conflict()`, `forbidden()` and others. They become `{ "detail": "..." }` responses, the same format as the old Python API. |
| `dto.ts` | Shared request/response pieces: paging, query arrays, dates |
| `scan-report.ts` | Records how each part of a scan went (ok / skipped / failed / not configured) and works out the overall run status |
| `brand-context.ts` | Turns a brand into search terms and scam queries for the detection modules |
| `allowlist.ts` | Normalises official domains, apps and handles, e.g. `https://www.X.com/` becomes `x.com` |
| `social-handle.ts` | Extracts a handle from a social profile URL |
| `imaging.ts` | Logo and favicon fingerprints (phash, dhash, favicon mmh3 hash) used to spot copied logos |
| `scoring.ts` | **Risk scoring** — the legacy rules exactly: points per signal, 0–100, Low/Medium/High/Critical, module clamps and weak-evidence caps (a name match alone is never Critical) |
| `confidence.ts` | **Confidence** — how good the evidence is (independent kinds of evidence, captured evidence, gaps, contradictions) |
| `fraud-themes.ts` | Fraud themes (jobs, education, loans, lottery, investment, delivery, government…): words for look-alike names, web-search queries, page detection |
| `relevance.ts` | Does a text refer to the brand: strong terms, short abbreviations that need a context word, look-alike names (legacy `BrandContext.relevance`) |
| `review.ts` | Analyst review statuses and the review body, shared by every module |
| `logo-comparison.ts` | The logo side-by-side comparison response shape, shared by phishing and social media |
| `similarity.ts` | How close a name is to a brand term (`zentr0va` vs `Zentrova` = 100); look-alike characters are folded first |

### 3.5 `integrations/`: clients for outside services

Each external API is wrapped here, so modules never call it directly. If a provider changes, only this folder changes.

| Folder | Use |
|---|---|
| `apify/apify.client.ts` | Raw Apify calls: start a run, wait for it, fetch results, read account usage |
| `apify/apify.runner.ts` | Runs many Apify actors. Results are cached in Redis, so the same search is not paid for twice. |
| `apify/apify.types.ts` | Apify types |
| `http/safe-fetch.ts` | **The only way to contact outside websites.** Blocks private, internal and cloud-metadata addresses (also after redirects and DNS tricks), caps size and time, retries, rate-limits per site |
| `dns/dns-client.ts` | DNS lookups (A/MX/NS/TXT) on public resolvers; tells "no record" apart from "lookup failed"; skips a resolver that is blocked |
| `intel/threat-intel.ts` | Threat sources: 5 phishing feeds (PhishTank, OpenPhish, Phishing.Database, Phishing Army, Phishunt), crt.sh certificate logs, urlscan.io and URLhaus (with keys) |
| `search/web-search.ts` | Web search: Brave or SerpAPI with a key, else DuckDuckGo (paced, cooled down after a refusal) |
| `storage/object-storage.ts` | Uploads, downloads and deletes files in S3-compatible storage, and creates time-limited download links. Used for brand logos now and evidence screenshots later. |

### 3.6 `db/`: database definition

| File | Use |
|---|---|
| `schema/core.ts` | Tables for users, brands, brand assets, the allowlist and app settings |
| `schema/scans.ts` | `scan_runs`: one row per scan or collection |
| `schema/social.ts` | Apify runs and collected social posts |
| `schema/detection.ts` | Look-alike domains (`phishing_domains`), email security checks (`email_posture_checks`), analysed emails (`email_messages`) |
| `schema/enums.ts`, `schema/columns.ts` | Shared enum types and column helpers (UUIDv7 IDs, timestamps) |
| `schema/index.ts` | Exports all tables |
| `migrate.ts` | Applies migrations |
| `bootstrap.ts` | Creates the first admin user from `.env` |

### 3.7 `modules/`: the features

Every module uses the same file names, so you always know where to look:

| File suffix | Layer | Use |
|---|---|---|
| `*.routes.ts` | Routes | URLs, auth guard (user or admin), request/response schemas |
| `*.controller.ts` | Controller | Reads input, calls the service, sets the status code |
| `*.service.ts` | Service | **Business rules** |
| `*.repository.ts` | Repository | Database queries (nothing else touches the DB) |
| `*.dto.ts` | DTO | What the API accepts and returns. Validated automatically and documented in `/docs`. |
| `*.mapper.ts` | Mapper | Converts database rows into API responses |
| `*.jobs.ts` | Jobs | Background work this module runs in the worker |

| Module | Use case |
|---|---|
| `health/` | `/health`: reports whether the API, database and Redis are up. A small reference example of every layer. |
| `auth/` | Login, `/me` and JWT tokens. `auth.guards.ts` provides `guards.user` (any signed-in user) and `guards.admin`. |
| `users/` | User lookups (repository only, for now) |
| `brands/` | The monitored brands: create, edit, delete, **search**, **add details** (keywords, domains, email domains, handles, apps), official logos and the allowlist |
| `scans/` | Scan-run history shared by all detection modules: start, finish, cancel, and close stuck runs |
| `social-media/` | Collects posts, ads and accounts (Apify: Instagram, TikTok, Facebook, Meta Ads, X, LinkedIn; free web search: 14 platforms), analyses and scores them for brand abuse, and records the analyst's review |
| `phishing-sites/` | Finds look-alike domains (typo variants, certificate logs, phishing feed), checks each one (DNS, website, login form, brand on page, SPF/DMARC, feed) and flags suspected phishing sites. Also checks one pasted URL on demand |
| `dashboard/` | Dashboard overview and module-explorer breakdown, computed from stored results |
| `email-security/` | Email security of the brand's own domains (SPF/DMARC/DKIM/MTA-STS) and analysis of uploaded suspicious emails (links, sender, authentication, attachments) |
| `system/` | Housekeeping jobs (`ping` so far) |

**Inside `phishing-sites/`** (besides the usual layers):

| File | Use |
|---|---|
| `dnstwist.ts` | Port of the dnstwist fuzzers the legacy backend used (16 fuzzers incl. IDN homoglyphs) |
| `variants.ts` | Legacy `generate_variants`: brand on every TLD, dnstwist with legacy affixes + fraud-theme words, cross-TLD, homoglyphs last, 12 000 cap |
| `host-matcher.ts` | Legacy HostMatcher: is a discovered host about the brand, and which name to monitor (registered domain, brand subdomain, hosting-platform site) |
| `page-check.ts` | Page facts (keywords, password field, brand on page, official refs, parked, fraud themes) and **image matching**: favicon (mmh3 / perceptual) and the top 40 page images vs the official logos |
| `domain-checker.ts` | Checks one domain end to end (website, page, images, TLS, SPF/DMARC, threat intel) → signals → risk score + confidence → legacy detail fields + evidence |

**Inside `email-security/`:** `posture.ts` (SPF/DMARC/DKIM/MTA-STS rules) and `email-analysis.ts` (parse an .eml, extract and unwrap links, read authentication results, flag risky attachments, decide the verdict).

**Inside `social-media/sources/`:**

| File | Use |
|---|---|
| `social-item.ts` | The common shape every platform's post is converted into |
| `web-search/web-search.source.ts` | Free source: `site:` web-search queries (brand + scam themes) over every platform; results are search snippets |
| `apify/apify.sources.ts` | Which Apify actor to run for each platform, with what search input |
| `apify/apify.collector.ts` | Runs the sources and gathers the results |
| `apify/mappers/*.mapper.ts` | One mapper per platform. Each converts that actor's raw output into a `social-item`. |

To add a new platform, add one source entry and one mapper.

**Inside `social-media/analysis/`** (port of legacy `social_media/analysis.py` + `module.py`):

| File | Use |
|---|---|
| `text.ts` | Contact details (Indian/toll-free/international numbers, WhatsApp, Telegram, UPI) and scam phrases (English, Hindi, hashtags) |
| `platforms.ts` | Platform and content type of a URL (14 platforms), URL keys |
| `social-analyser.ts` | One item → official? relevant? thumbnail logo check → signals → risk score, confidence, headline, reasons, evidence |

`brands/logo-templates.ts` prepares a brand's official logos for matching once and caches them; the phishing and
social media services share one instance (built in `container.ts`).

### 3.8 `plugins/` and `workers/`

| File | Use |
|---|---|
| `plugins/error-handler.ts` | One place that turns every error into the `{ "detail": ... }` format: 422 for invalid input, 500 for anything unexpected |
| `workers/registry.ts` | Maps job names to their handlers (e.g. `social-media.collect` → `SocialMediaService.runCollection`) and lists scheduled jobs |

---

## 4. `test/`

| File | Tests |
|---|---|
| `app.test.ts` | Health, login, auth guards, error format |
| `brands.test.ts` | The full brands API against the real database and storage |
| `social-media.test.ts` | Collection flow with a fake Apify, so no money is spent |
| `apify.unit.test.ts` | Apify client, runner and platform mappers |
| `imaging.unit.test.ts` | Logo fingerprints, allowlist normalisation, brand rules |
| `detection.unit.test.ts` | Safe-fetch address blocking, look-alike generation, similarity, page facts, verdicts, email posture and email analysis (no network) |
| `detection.test.ts` | Brand search/details, phishing check and full scan, email posture and upload — through the API with fake DNS, websites and feeds |
| `fixtures/images/` | Sample logo, a re-encoded copy, an unrelated image and a favicon |

Run with `npm test`. Most tests need `npm run services:up` first.

---

## 5. Worked example: "Collect social media for a brand"

1. `POST /api/v1/social-media/collections` reaches **`social-media.routes.ts`**, which checks login and validates the body against the DTO.
2. **`social-media.controller.ts`** calls `SocialMediaService.startCollection`.
3. The **service** checks that the brand exists (`BrandsRepository`) and creates a `scan_runs` row (`ScansRepository`). It then puts a job on the queue, and the API replies at once.
4. The **worker** picks up the job: `workers/registry.ts` → `social-media.jobs.ts` → `runCollection`.
5. **`ApifyCollector`** builds the searches from `common/brand-context.ts`. It runs the actors through `integrations/apify`, with results cached in Redis.
6. The **platform mappers** convert raw results, and **`SocialMediaRepository`** saves them without duplicates.
7. **`scan-report.ts`** works out the final status, and the run is marked finished.

---

## 6. Adding a new feature (e.g. alerts)

1. Add the tables in `src/db/schema/`. Then run `npm run db:generate` and `npm run db:migrate`.
2. Create `src/modules/alerts/` with `alerts.dto.ts`, `alerts.repository.ts`, `alerts.mapper.ts`, `alerts.service.ts`, `alerts.controller.ts`, `alerts.routes.ts`, and `alerts.jobs.ts` if it needs background work.
3. Construct its classes in `src/container.ts`.
4. Register its routes in `src/app.ts`, and its jobs in `src/workers/registry.ts` if it has any.
5. Add tests in `test/`.

---

## 7. Ports and commands

| What | Port |
|---|---|
| API | 8020 (Swagger UI at `/docs`) |
| Postgres | 5433 |
| Redis | 6380 |
| File storage (S3) | 9100 (console 9101) |

| Command | Does |
|---|---|
| `npm run services:up` | Starts Postgres, Redis and storage |
| `npm run db:migrate` | Applies migrations |
| `npm run dev` | Runs the API with reload |
| `npm run dev:worker` | Runs the worker with reload |
| `npm test` | Runs all tests |
| `npm run typecheck` / `npm run lint` | Type and lint checks |
