# Brand Intelligence API — reference

Base URL (local): `http://localhost:8020/api/v1`
Interactive docs (try every call in the browser): `http://localhost:8020/docs` (Swagger, generated from the code)

This file explains **what each endpoint is for, what to send, what comes back, and what can go wrong**. Swagger lists
every field and type; this document adds the meaning, the rules and worked examples.

| Area | Prefix | What it does |
|---|---|---|
| [Auth](#auth) | `/auth` | Sign in, who am I |
| [Brands](#brands) | `/brands` | Brands to protect: create, **search**, **add details**, official images, allowlist |
| [Phishing websites](#phishing-websites) | `/phishing` | Find look-alike domains and phishing sites for a brand, with logo matching and risk scores |
| [Risk scoring](#risk-scoring) | — | How every result is scored (legacy rules) |
| [Dashboard](#dashboard) | `/dashboard` | Overview numbers and the module explorer, from real results |
| [Email security](#email-security) | `/email` | Brand domain email security (SPF/DMARC/DKIM) and **suspicious email analysis** |
| [Social media](#social-media) | `/social-media` | Collect posts, ads and accounts mentioning the brand (via Apify) |
| [Health](#health) | `/health` (outside `/api/v1`) | Is the API, database and Redis up |

---

## Conventions

### Authentication
Every endpoint except `POST /auth/login` and `/health/*` needs a token:

```
Authorization: Bearer <access_token>
```

Roles: **analyst** can read everything and run scans/checks; **admin** can also change brands. A missing/expired
token → `401`; an analyst calling an admin endpoint → `403 {"detail": "Admin role required"}`.

### Errors
Every error has the same body:

```json
{ "detail": "Brand not found" }
```

Validation errors (wrong field, wrong type) → `422` with a list:

```json
{ "detail": [ { "loc": ["body", "brand_id"], "msg": "Invalid UUID" } ] }
```

| Status | Meaning |
|---|---|
| 400 | The request is valid but not allowed now (e.g. checking the brand's own domain, cancelling a finished scan) |
| 401 | Not signed in / token expired |
| 403 | Signed in but not allowed (admin only) |
| 404 | The thing does not exist |
| 409 | Duplicate (brand name, allowlist value) |
| 413 | Upload too large |
| 422 | Invalid input (see `detail`) |
| 429 | Too many requests — wait a minute |

### Paging
List endpoints that can grow take `?page=1&page_size=25` (max 200) and return:

```json
{ "items": [ … ], "total": 128, "page": 1, "page_size": 25 }
```

### Repeating filters
Filters that accept several values are repeated: `?brand_id=A&brand_id=B&verdict=Suspicious`.

### Dates and IDs
Dates are ISO-8601 UTC (`2026-11-23T10:15:00.000Z`); date-only filters are `YYYY-MM-DD`. IDs are UUIDs.

### Background work
Long jobs (scans, collections) return **`202 Accepted`** with a scan record whose `status` is `queued`. Poll the
scan's `GET` endpoint until `status` is one of:

| status | meaning |
|---|---|
| `queued` / `running` | still working |
| `completed` | every part ran |
| `partially_completed` | some parts were skipped or not configured, the rest ran |
| `completed_with_errors` | some parts failed (see `components`), the rest ran |
| `failed` | nothing useful ran (see `error`) |
| `cancelled` | stopped by a user |

`components` says what **each part** did, so "nothing found" is never confused with "could not check":

```json
{ "name": "Certificate Transparency (crt.sh)", "status": "failed", "message": "crt.sh returned HTTP 503", "counts": {} }
```

---

## Auth

### `POST /auth/login`
Sign in. Rate limited to 10 per minute.

```json
// request
{ "email": "admin@example.com", "password": "…" }
// 200
{ "access_token": "eyJ…", "token_type": "bearer",
  "user": { "id": "…", "email": "admin@example.com", "name": "Admin", "role": "admin", "is_active": true, "created_at": "…" } }
```
`401 {"detail": "Invalid email or password"}`

### `GET /auth/me`
The signed-in user (same `user` object as above).

---

## Brands

A **brand** is what we protect. What a brand knows drives every scan:

| Field | Used for |
|---|---|
| `name`, `keywords`, `product_terms` | the words searched for (keywords default to the lower-case name). Words only — never website addresses |
| allowlist `domain` | official websites: seeds for look-alike generation, never reported as threats |
| allowlist `email_domain` | domains the brand sends mail from: checked by email security, trusted as senders |
| allowlist `social_handle` | official accounts: never reported as impersonation |
| allowlist `package`, `publisher`, `signing_cert` | official apps (for the app modules) |
| `assets` | official logo / favicon / app icon images, fingerprinted to spot copies |

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/brands` | user | every brand, by name |
| **GET** | **`/brands/search`** | user | **search brands by any detail, with filters and paging** |
| POST | `/brands` | admin | create |
| GET | `/brands/{id}` | user | one brand |
| PATCH | `/brands/{id}` | admin | change the fields sent |
| DELETE | `/brands/{id}` | admin | delete with everything that belongs to it |
| **POST** | **`/brands/{id}/details`** | admin | **add keywords, domains, email domains, handles, apps… in one call** |
| POST | `/brands/{id}/assets` | admin | upload an official image |
| DELETE | `/brands/{id}/assets/{assetId}` | admin | remove an image |
| GET / POST | `/brands/{id}/allowlist` | user / admin | list / add one allowlist value |
| DELETE | `/brands/{id}/allowlist/{allowId}` | admin | remove one |

### The brand object

```json
{
  "id": "0193…", "name": "Zentrova Bank", "description": "Retail bank",
  "keywords": ["Zentrova", "Zentrova Bank"], "product_terms": ["Zentrova Pay"],
  "is_active": true, "alert_min_level": "Medium",
  "auto_scan_enabled": false, "auto_scan_frequency": "daily", "auto_scan_runners": [],
  "last_auto_scan_at": null, "next_auto_scan_at": null, "created_at": "…",
  "assets": [ { "id": "…", "kind": "logo", "filename": "logo.png", "content_type": "image/png",
                "sha256": "…", "phash": "c3c3…", "mmh3": null, "created_at": "…", "url": "<time-limited link>" } ],
  "allowlist": [ { "id": "…", "kind": "domain", "value": "zentrova.com" } ],
  "open_alerts": 0
}
```

### `GET /brands/search` — search brand details

Finds brands whose **name, description, keywords, product terms or any allowlist value** (official domain, email
domain, social handle, app package, publisher) contains `q`. Each result says where it matched.

| Query | Type | Meaning |
|---|---|---|
| `q` | text | text to find (case-insensitive, part of a word is fine) |
| `is_active` | true/false | only active / inactive brands |
| `has_domain` | true/false | brands with / without an official domain |
| `auto_scan_enabled` | true/false | brands with automatic scans on / off |
| `sort` | `name` (default) \| `created_at` | order |
| `page`, `page_size` | int | paging |

```
GET /api/v1/brands/search?q=zentrova&has_domain=true
```
```json
{ "items": [ { …brand…, "matched_on": ["name", "keyword", "domain"] } ], "total": 1, "page": 1, "page_size": 25 }
```
`matched_on` values: `name`, `description`, `keyword`, `product_term`, `domain`, `email_domain`, `social_handle`,
`package`, `publisher`, `signing_cert`.

### `POST /brands` — create

```json
{ "name": "Zentrova Bank", "keywords": ["Zentrova"],
  "allowlist": [ { "kind": "domain", "value": "https://www.zentrova.com/" } ] }
```
Rules: name unique (`409 "A brand with this name already exists"`); keywords must be words, not websites (`422`);
unknown fields are rejected (`422`); allowlist values are normalised (`https://www.Zentrova.com/` → `zentrova.com`,
a profile link → `instagram.com/handle`).

### `POST /brands/{id}/details` — add brand details

Adds to what the brand already has; **nothing is removed**. Every value is checked separately: duplicates and
unreadable values are returned in `skipped` with the reason, so one bad value never blocks the rest.

| Field | Saved as |
|---|---|
| `keywords`, `product_terms` | merged into the brand's word lists (case-insensitive de-duplication) |
| `domains` | allowlist `domain` |
| `email_domains` | allowlist `email_domain` (an address like `alerts@x.com` is reduced to `x.com`) |
| `social_handles` | allowlist `social_handle` (profile URL or `@handle`) |
| `packages` | allowlist `package` (`com.zentrova.app` or a Play Store link) |
| `publishers` | allowlist `publisher` |
| `signing_certs` | allowlist `signing_cert` (SHA-256 fingerprint, 64 hex) |
| `description` | replaces the description |

```json
// POST /api/v1/brands/{id}/details
{ "keywords": ["Zentrova Bank", "zentrova.com"],
  "domains": ["https://www.Zentrova.com/"],
  "email_domains": ["alerts@zentrovamail.com"],
  "social_handles": ["https://instagram.com/ZentrovaBank"],
  "signing_certs": ["not-a-cert"] }
```
```json
// 200
{ "brand": { …updated brand… },
  "added": { "keywords": ["Zentrova Bank"], "product_terms": [],
             "allowlist": [ {"id":"…","kind":"domain","value":"zentrova.com"},
                            {"id":"…","kind":"email_domain","value":"zentrovamail.com"},
                            {"id":"…","kind":"social_handle","value":"instagram.com/zentrovabank"} ],
             "description": false },
  "skipped": [ { "field": "keywords", "value": "zentrova.com", "reason": "Looks like a website address — send it in domains instead" },
               { "field": "signing_certs", "value": "not-a-cert", "reason": "A signing certificate must be its SHA-256 fingerprint (64 hex characters)" } ] }
```
At least one field must be sent (`422` otherwise).

### `PATCH /brands/{id}`
Send only the fields to change (`name`, `description`, `keywords`, `product_terms`, `is_active`, `alert_min_level`,
`auto_scan_enabled`, `auto_scan_frequency`, `auto_scan_runners`). `null` = leave unchanged. Note: `keywords` here
**replaces** the list; use `/details` to add.

### `POST /brands/{id}/assets`
`multipart/form-data` with `kind` (`logo` | `favicon` | `app_icon`, default `logo`) and `file` (PNG, JPG, GIF, WEBP,
ICO, BMP; max 5 MB). `413` too large, `422` not an image.

```bash
curl -X POST "$API/brands/$ID/assets" -H "Authorization: Bearer $T" -F kind=logo -F file=@logo.png
```

### Official login pages — `POST /brands/{id}/login-pages`, `POST …/{pageId}/capture`, `DELETE …/{pageId}`
The brand's **real** login page(s) (admin). Body `{"url": "https://www.example.com/login"}` → `201` with
`status: "pending"`; the sandboxed browser worker then captures it: screenshot, layout fingerprint (4×4 region
thumbnails + perceptual hash + colour palette), the words on the page (OCR) and the **form signature** read from the
rendered page (what it asks for: `password`, `customer_id`, `otp`, `pin`, `card`, `cvv` …). `409` = already added.
`…/capture` captures it again; `DELETE` removes it and its screenshot. Each brand object lists them:
```json
"login_pages": [{ "id": "…", "url": "https://omni.axis.bank.in/axisretailbanking/", "status": "ready",
                  "screenshot_url": "<signed>", "captured_at": "…", "error": null, "title": "Login | AxisOmniChannel",
                  "asks": ["customer_id", "password"] }]
```
`error` is set when the page could not be loaded or no login form was found on it.

---

## Phishing websites

Finds **look-alike domains and phishing websites** that use a brand — for any kind of fraud (fake login pages, fake
customer care, job and admission scams, loans, lottery, investment, delivery, government schemes…) — and scores each
one with the **same risk rules as the legacy Python backend**, with **official logo and favicon matching** on the page.

### How a scan works

**1. Discovery** — every source is reported separately in the scan's `components`; a source that could not run says
so (it is never shown as "nothing found"):

| Source | What it finds | Needs |
|---|---|---|
| Variant generation | dnstwist-style typos of each official domain (same fuzzers as the legacy backend: omission, replacement, bitsquatting, transposition, homoglyph incl. IDN/xn--, cyrillic, hyphenation, insertion, addition, repetition, plural, subdomain, vowel-swap, various, dictionary, tld-swap), the dictionary being the legacy 51 affixes **plus every fraud-theme word** (careers, admission, scholarship, lottery, loan, refund, delivery, subsidy…), the brand on every monitored TLD, and cross-TLD copies. Up to 12 000 names (legacy cap), most phishing-prone first, homoglyph/bitsquatting last. | — |
| Certificate Transparency (crt.sh) | names that got a TLS certificate containing a brand word — kept as the site, the brand subdomain or the hosting-platform site | — (crt.sh is often busy; retried, then reported) |
| Phishing feeds | PhishTank, OpenPhish, Phishing.Database, Phishing Army, Phishunt (~580 000 entries, cached 6 h); brand words **and look-alike spellings** (zentr0va) | — |
| Web search | brand pages on 23 free hosting platforms (vercel.app, web.app, netlify.app…), brand-titled login pages, and **one query per fraud theme** | Brave or SerpAPI key; without one, DuckDuckGo is used (paced, best effort) |
| urlscan.io | hostnames / page titles with the brand in public scans | `URLSCAN_API_KEY` |
| Known domains | everything already found for the brand is re-checked | — |

Each discovered host goes through the legacy **HostMatcher**: official domains and big sites are dropped, short brand
words only count next to a risk word ("axis-kyc" yes, "praxis" no), and a host is kept as the registered domain,
the exact subdomain (brand only in the subdomain) or the hosting-platform site.

**2. DNS** — NS then A first (cheap for the thousands of unregistered names); registered names get A, AAAA, MX, NS.

**3. Per registered domain** (all outbound requests through the safe fetcher):
- **Website**: https then http; page text read (scripts never run).
- **Page facts**: phishing keywords, password field, form targets, brand terms on the page (its own domain removed),
  references to official sites, parked/for-sale page, **fraud themes** shown on the page.
- **Image matching** (the strongest evidence):
  - **favicon**: declared icon or /favicon.ico → Shodan mmh3 equal to an official favicon = 100, else perceptual
    hash against every official image;
  - **top page images**: up to 40 per page — `<img>` src / srcset / lazy `data-src`, og:image, CSS backgrounds and
    inline SVG (rendered) — each fingerprinted (pHash + dHash) and compared with the official logos and app icons.
  - A score ≥ `LOGO_MATCH_THRESHOLD` (85) is a match → `official_logo` (+30 points) and brand evidence on the page.
  - The matched image, the favicon and the page HTML are stored as evidence (download links in the result).
  - Upload the brand's logo and favicon (`POST /brands/{id}/assets`) — without them the scan reports
    "Official logo assets: not configured".
- **Screenshot**: every live site is opened in a **sandboxed headless browser on the worker** (never in the API):
  every request the page makes is checked against the safe-fetcher rules (private / internal / metadata addresses
  aborted), downloads and service workers are off, height capped at 6000 px. The PNG is stored as evidence and
  returned as `screenshot_url` (also on list rows, for thumbnails). Screenshots are queued after each scan and each
  single check; `POST /phishing/domains/{id}/screenshot` takes a new one. `SCREENSHOTS_ENABLED`,
  `BROWSER_EXECUTABLE_PATH` (default: Playwright Chromium, else installed Chrome), `BROWSER_MAX_PAGES` (2),
  `BROWSER_TIMEOUT_SECONDS` (30).
- **TLS certificate** (issuer, expiry, self-signed) → `https`.
- **Email records** of the look-alike: SPF (can send email), DMARC.
- **Threat intel**: the 5 feeds, urlscan.io verdicts, URLhaus — "listed by" counts distinct sources.

**4. Risk and confidence** — see [Risk scoring](#risk-scoring). `stage` = `phishing` (live website), `mx` (mail
servers only) or `typosquat` (registered, nothing else). `suspected` = live, brand on the page, not parked, a
look-alike name, and a login/payment form, favicon or logo match — or listed by two sources.

| verdict | when |
|---|---|
| `Suspected phishing website` | see `suspected` above |
| `Live look-alike website` | answers, not (yet) phishing |
| `Parked look-alike domain` | parked / for-sale page |
| `Email-enabled look-alike domain` | no website, has mail servers |
| `Registered look-alike domain` | registered, nothing else seen |

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/phishing/scans` | start a scan (`202`) |
| GET | `/phishing/scans` | recent scans (`?brand_id=&limit=`) |
| GET | `/phishing/scans/{id}` | one scan (status, components, totals) |
| POST | `/phishing/scans/{id}/cancel` | stop it |
| POST | `/phishing/check` | check one domain or URL now (same checks and scoring) |
| GET | `/phishing/domains` | search results |
| GET | `/phishing/domains/{id}` | one result with every detail, score breakdown and evidence |
| PATCH | `/phishing/domains/{id}/review` | analyst decision |
| POST | `/phishing/domains/{id}/screenshot` | take a new browser screenshot (`202`, worker) |
| GET | `/phishing/variants` | preview generated names (no network) |
| GET | `/phishing/themes` | fraud themes searched |

### `POST /phishing/scans`

| Field | Meaning |
|---|---|
| `brand_id` | required |
| `sources` | any of `variants`, `certificate_transparency`, `phishing_feeds`, `web_search`, `urlscan` (default all) |
| `themes` | fraud themes to search (default all) — see `GET /phishing/themes` |
| `max_variants` | 1–12000 (default `PHISHING_MAX_VARIANTS` = 12000) |

`202` with the scan (`status: queued`). Needs the worker (`npm run dev:worker`; scans run on the `browser` queue).
When finished, `stats` has `candidates`, `registered`, `checked`, `new_domains`, `live`, `suspected`, `logo_matches`,
`email_enabled`, `critical`/`high`/`medium`/`low`, `duration_seconds`. A scan stops starting new checks after
`PHISHING_SCAN_BUDGET_SECONDS` (45 min); the rest are reported and checked first next scan.

### The result object (`GET /phishing/domains/{id}`, `POST /phishing/check`)

```json
{
  "id": "…", "brand_id": "…", "brand_name": "Zentrova Bank",
  "domain": "zentrova-login.com", "title": "Suspected phishing website: zentrova-login.com",
  "source": "dictionary", "source_label": "Added prefix/suffix", "stage": "phishing",
  "risk_score": 100, "risk_level": "Critical", "confidence": 85, "confidence_level": "High",
  "scoring": {
    "risk": { "score": 100, "level": "Critical", "raw_score": 100, "cap": null, "cap_reason": null, "policy": "2026-10-16",
              "rules": { "brand_exact_in_domain": 40, "typo_similarity_gt_80": 25, "mx_present": 15, "https": 10,
                         "login_payment_keywords": 20, "official_logo": 30 } },
    "confidence": { "score": 85, "level": "High", "factors": [ { "factor": "visual", "points": 15, "why": "Official logo or favicon matched" }, … ] }
  },
  "logo_match": true, "logo_match_score": 94, "favicon_match": true,
  "fraud_themes": ["account_login"],
  "live": true, "http_status": 200, "final_url": "https://zentrova-login.com/", "page_title": "Zentrova Bank Login",
  "dns_status": "registered", "a_records": ["…"], "mx_records": ["10 mx.zentrova-login.com"], "ns_records": ["…"],
  "similarity": 94.12, "closest_term": "zentrova",
  "signals": { "brand_exact_in_domain": true, "typo_similarity": 94.12, "official_logo": true, "page_live": true, "brand_on_page": true, … },
  "details": {
    "Website Live": true, "SSL Present": true, "SSL Issuer": "Let's Encrypt", "Email Risk": "High",
    "SPF Record": "v=spf1 a mx -all", "DMARC Record": null, "Email-ready": true,
    "Logo Match Score": 94, "Matched Image URL": "https://zentrova-login.com/assets/logo.jpg",
    "Favicon Match": true, "Favicon Match Score": 100, "Images Found": 2, "Images Compared": 2,
    "Top Image Matches": [ { "url": "…/logo.jpg", "score": 93.75 }, { "url": "…/tree.png", "score": 67.97 } ],
    "Keywords Found": ["login", "kyc"], "Password Field": true, "Form Actions": ["https://zentrova-login.com/steal"],
    "Brand Terms On Page": ["Zentrova"], "Official Site References": [], "Parked Page": false,
    "Fraud Themes": [ { "key": "account_login", "label": "Account / login phishing", "words": ["login", "kyc"] } ],
    "Threat Intel": "Not listed by OpenPhish, Phishing Army (not checked: urlscan.io, URLhaus)",
    "Threat Intel Sources": [ { "tool": "OpenPhish", "status": "ok", "malicious": false }, … ],
    "Discovery Source": "Typosquat generation (Added prefix/suffix)", "Hosting Platform": null, "Risk": { … }
  },
  "evidence": [ { "kind": "image", "content_type": "image/png", "url": "<time-limited link>", "meta": { "url": "…", "logo_match_score": 93.75 } },
                { "kind": "favicon", … }, { "kind": "html", … }, { "kind": "ssl", … } ],
  "screenshot_url": "<time-limited link to the stored PNG>", "screenshot_taken_at": "…", "screenshot_error": null,
  "suspected": true, "verdict": "Suspected phishing website",
  "review_status": "New", "review_note": null, "reviewed_at": null, "reviewed_by": null,
  "first_seen": "…", "last_checked": "…", "times_checked": 2, "scan_id": "…"
}
```
**`logo_comparison`** — the official logo next to the best image found on the site (`null` when no image was compared):
`matched`, `score` (0–100: shape 35 %, design 25 %, colour 20 %, text 20 %), `method` (`shape` | `fingerprint` | null =
not found), `source` (`page_image` | `screenshot`), `checks` {shape, design, colour, text}, `inliers` (matching points;
≥ 25 needed), `box` (corners of the located logo, original pixels), `points` (official x,y → found x,y), `colours`
(dominant colours each side), `text_found` (OCR), `reason`, `found_image_url`, `official_logo_url`, `candidates`
(the other images compared and why each was rejected). See `src/integrations/vision/logo-matcher.ts`.

**`data_requested`** — what the page asks visitors to type, read from the page as served and again as rendered in the browser: `asks` (`password`, `username`, `customer_id`, `email`, `phone`, `otp`, `pin`, `card`, `cvv`, `expiry`, `account`, `dob`, `captcha`, `aadhaar`, `pan`, `upi`), `sensitive` (the confidential ones: password, OTP, PIN, card, CVV, expiry, account, Aadhaar, PAN, UPI, date of birth), `categories` (`credentials` | `payment` | `identity` | `contact`), `is_login`, `fields`; `null` = no input fields. Asking for anything confidential turns on `login_payment_keywords` (+20) and re-scores the domain.

**`visual_check`** — `pending` (the browser check is queued), `done` (screenshot taken, every rendered picture compared with the official logos, forms read, login page compared), `failed` (the page could not be opened), `not_live`. Every live domain found by a scan or a manual check is queued automatically; bulk re-checks (`POST /phishing/domains/recheck-images`) queue with a lower priority so newly found domains are always checked first.

**`login_comparison`** — set when the site's page has a login form and the brand has official login pages:
`cloned`, `score` (layout 35 %, text 35 %, form 30 %), `checks` {layout, text, form, logo}, `layout` {grid, overall,
palette}, `text` {shared words, officialWords}, `form` {shared, onlyOfficial, onlySuspect, sharedButtons},
`reference_url`, `reference_screenshot_url`, `reason`. A copy (`cloned: true`: login form, score ≥ 65, layout ≥ 50 or
the official logo, and at least one credential asked by both) turns on the `login_page_clone` rule and re-scores the
domain. It runs after the screenshot (browser worker), so it appears a little after the first result.

`POST /phishing/check` returns the same object plus `stored` (unregistered names: `stored: false`, `id: null`,
`verdict: "Not registered"`). Checking an official domain → `400`. Limited to 20 per minute per user.

### `GET /phishing/domains` — search results
Extra filters: `asks_data=true` (asks for confidential data), `asks=otp&asks=card…` (asks for any of these), `visual_check=pending|done|failed`.
List items are the object above without `details` and `evidence`. Sorted riskiest first by default.

| Query | Meaning |
|---|---|
| `brand_id` (repeatable) | brands |
| `q` | text in the domain or page title |
| `risk_level` (repeatable) | Low, Medium, High, Critical |
| `min_score` | 0–100 |
| `open` | true = review status New / Investigating / Confirmed Threat |
| `review_status` (repeatable) | any review status |
| `logo_match` | true = official logo matched on the page |
| `suspected`, `live`, `mx` | true / false |
| `stage` (repeatable) | phishing, mx, typosquat |
| `source` (repeatable) | e.g. `dictionary`, `homoglyph`, `certificate-transparency`, `phishing-feed`, `search-engine`, `manual` |
| `theme` (repeatable) | fraud theme key, e.g. `jobs`, `education` |
| `verdict` (repeatable), `min_similarity`, `scan_id` | |
| `since`, `until` | first seen between (YYYY-MM-DD) |
| `sort` | `risk` (default), `last_checked`, `similarity`, `first_seen`, `domain` |

### `PATCH /phishing/domains/{id}/review`
```json
{ "status": "False Positive", "note": "Parked by a domain reseller" }
```
Statuses: New, Investigating, Confirmed Threat, False Positive, Legitimate, Ignored, Resolved. A note is required for
False Positive, Legitimate and Ignored (`422` otherwise). Later scans refresh the facts and score but keep the decision.

### `GET /phishing/themes`
The fraud themes: `account_login`, `customer_support`, `jobs`, `education`, `loans_credit`, `payments_refunds`,
`rewards_lottery`, `investment`, `delivery`, `government_tax`, `shopping`, `app_download` — each with its label, the
domain words it adds to look-alike generation, and its web-search query.

### `GET /phishing/variants?brand_id=…&limit=200`
`{ "seeds": ["zentrova.com"], "total": 12000, "variants": [ { "domain": "zentrova.in", "fuzzer": "tld-swap", "fuzzer_label": "TLD variation", "seed": "zentrova.com" }, … ] }`

---

## Risk scoring

The same rules as the legacy backend (`SCORING_POLICY 2026-10-16`), in `src/common/scoring.ts` — one pure function,
unit-tested rule by rule, including every level boundary and the cap.

**Points** (sum, capped at 100):

| Rule | Points | Rule | Points |
|---|---|---|---|
| brand_exact_in_domain | 40 | known_malicious_url (≥ 2 sources) | 40 |
| typo_similarity_gt_80 (strictly > 80) | 25 | single_source_url_hit | 15 |
| mx_present | 15 | lookalike_can_send (SPF) | 10 |
| https | 10 | lookalike_sender | 25 |
| login_payment_keywords | 20 | brand_impersonation | 20 |
| **official_logo** | **30** | auth_fail_brand_from | 30 |
| **login_page_clone** (Node addition) | **30** | | |
| social_image_match | 20 | reply_to_mismatch | 10 |
| publisher_mismatch | 25 | credential_or_payment_language | 15 |
| posture_dmarc_missing / spf_missing | 40 / 40 | suspicious_attachment | 20 |
| posture_dmarc_none / spf_softfail / dkim_missing / mta_sts_missing | 20 / 10 / 10 / 5 | | |

`login_page_clone` is not in the legacy policy: a copy of the brand's official login page (see Phishing websites →
`login_comparison`). It counts as visual evidence for confidence, like the official logo.

**Levels**: 0–29 Low · 30–59 Medium · 60–79 High · 80–100 Critical.

**Weak-evidence caps** for look-alike domains (a name match alone is never Critical):

| cap | highest score | when |
|---|---|---|
| parked_page | 29 (Low) | parked / for-sale page |
| no_brand_evidence | 29 (Low) | live page shows no brand (no logo, favicon, brand name or official link) and no login form |
| no_brand_login_form | 59 (Medium) | login/payment form but no brand on the page |
| no_website | 79 (High) | no website seen — unless listed by two threat-intel sources |

**Confidence** (0–100, `src/common/confidence.ts`): how good the evidence is — base 20, +15 per independent kind of
evidence (content, contact, visual = logo/favicon, identity), +5 infrastructure, +30 threat intel (≥ 2 sources),
+10 corroborated, +10 analysed, +10 evidence captured, minus coverage gaps (page unreadable, intel not checked) and
contradictions (parked −20, live page without the brand −15). High ≥ 70, Medium ≥ 40.

Email results use the email rules; brand-domain posture checks use the posture rules. Every stored result keeps its
breakdown (`scoring.risk.rules`, `cap_reason`, `scoring.confidence.factors`) so the score can always be explained.

---

## Dashboard

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard/overview` | every dashboard number (real data) |
| GET | `/dashboard/breakdown` | module explorer |

**`GET /dashboard/overview`** — query: `brand_id`, `risk_level`, `theme` (repeatable), `days` (default 30) or
`from`/`to`. Returns `open` (by risk, oldest high-risk open), `new_alerts` (+ previous period and per-day counts),
`confirmed`, `median_hours_to_decision`, `false_positive_rate` (each with `previous`), `trend` (per day by risk),
`workflow` (open by status, closed in the period by outcome), `categories` (phishing websites, email-enabled
look-alikes, registered look-alikes, official logo misuse), `themes` (per fraud theme), `brands` (per-brand pressure,
last scan, coverage gaps), `coverage_gaps`, `attention` (8 riskiest open High/Critical) and `attention_total`.
Cached 30 s.

**`GET /dashboard/breakdown`** — `group` = `stage` (modules) | `source` (sub-modules: how found) | `theme`;
`measure` = `new` | `open`; filters `brand_id`, `risk_level`, `theme`, `stage`, `source`, `logo_match`, `days` /
`from` / `to`. Returns `rows` (`key`, `label`, `total`, `previous`, `by_risk`) and a per-day `trend`.

---

## Email security

Two jobs: (1) is the **brand's own email domain** protected against spoofing, and (2) is **a suspicious email**
someone received a phishing attempt using the brand.

| Method | Path | Purpose |
|---|---|---|
| POST | `/email/posture/check` | check SPF / DMARC / DKIM / MTA-STS now |
| GET | `/email/posture` | latest result per domain (`?view=history` for all) |
| POST | `/email/messages` | **upload a suspicious `.eml` → analysed now** |
| GET | `/email/messages` | **search analysed emails** |
| GET | `/email/messages/{id}` | one analysed email |

### `POST /email/posture/check`
Send `brand_id` (checks every official + email domain of the brand), `domain` (one domain), or both.

```json
// request
{ "brand_id": "…" }
// 200 — one result per domain
[ { "id": "…", "brand_id": "…", "domain": "zentrova.com", "status": "issues",
    "issues": [ { "code": "dmarc_none", "severity": "medium", "message": "DMARC policy is p=none — spoofed email is still delivered; move to quarantine or reject" },
                { "code": "spf_softfail", "severity": "low", "message": "SPF ends in ~all (soft fail) — …" } ],
    "result": { "dmarc_record": "v=DMARC1; p=none; rua=…", "dmarc_policy": "none", "dmarc_rua": "mailto:…",
                "spf_record": "v=spf1 include:_spf.google.com ~all", "spf_all": "~all",
                "dkim_selectors_found": [], "mta_sts": false, "errors": [], "summary": "4 issues: …" },
    "checked_at": "…" } ]
```

| issue code | severity | meaning |
|---|---|---|
| `dmarc_missing` | high | no DMARC record, several, or no policy — anyone can spoof the domain |
| `dmarc_malformed` | high | DMARC text present but invalid |
| `dmarc_none` | medium | `p=none`: spoofed mail is still delivered |
| `spf_missing` | medium | no SPF record, or several |
| `spf_pass_all` | high | `+all`: every server may send as the domain |
| `spf_softfail` | low | `~all` instead of `-all` |
| `dkim_missing` | low | no DKIM key under common selectors (a custom selector cannot be discovered) |
| `mta_sts_missing` | low | no MTA-STS policy |

`status`: `good` (no issues), `issues`, or `error` (DNS lookups failed — nothing is claimed missing). The brand needs
at least one `domain` or `email_domain` in its allowlist (`400` otherwise).

### `POST /email/messages` — analyse a suspicious email
`multipart/form-data` with `brand_id` and `file` (the original message as `.eml`, max 25 MB; in Outlook: drag the mail
to a folder or File › Save As). Limited to 30 per minute per user.

```bash
curl -X POST "$API/email/messages" -H "Authorization: Bearer $T" -F brand_id=$BRAND -F file=@suspicious.eml
```

What is checked (links are **never visited**, attachments **never opened**):
- **Sender**: From / Reply-To / Return-Path, sending server IP (oldest public IP in `Received`)
- **Authentication**: SPF, DKIM, DMARC results from `Authentication-Results`, plus our own lookup of the sender
  domain's DMARC record (`dmarc_record`: `present` | `none` | `temperror`)
- **Links**: from text and HTML; defanged links (`hxxp`, `[.]`) restored; Microsoft Safe Links / Google redirects
  unwrapped; link text showing a different site than the real target flagged; checked against all 5 phishing feeds
- **Attachments**: name, type, size, SHA-256; flagged when executable, double extension (`invoice.pdf.exe`),
  macro-enabled Office, archive, or HTML

`signals`: `known_malicious_url`, `auth_fail_brand_from` (claims the brand's domain and fails DMARC),
`lookalike_sender` (a sender/link domain is a look-alike of the brand), `brand_impersonation` (mentions the brand
but is not from it), `reply_to_mismatch`, `link_text_mismatch`, `credential_or_payment_language`,
`suspicious_attachment`, `official_sender`.

| verdict | when |
|---|---|
| `Likely phishing` | a link is listed by a phishing feed, or it claims the brand's own domain and fails DMARC |
| `Suspicious` | look-alike sender/link domain; or brand impersonation together with urgent/credential language, reply-to mismatch or a misleading link; or a risky attachment |
| `Low risk` | none of the above |

Responses: `201` first upload, `200` the same email again (re-analysed, same `id`). `413` too large, `422` missing
`brand_id`/`file` or not an email.

```json
{ "id": "…", "brand_id": "…", "fingerprint": "<kyc-1@zentrova-login.com>", "sha256": "…", "channel": "upload",
  "subject": "Your Zentrova account will be suspended", "from_address": "alerts@zentrova-login.com",
  "from_domain": "zentrova-login.com", "reply_to": null, "return_path": null, "sender_ip": "45.33.32.156",
  "received_at": null,
  "auth": { "spf": null, "dkim": null, "dmarc": null, "dmarc_record": "none", "dmarc_policy": null },
  "urls": [ { "url": "https://zentrova-login.com/verify", "domain": "zentrova-login.com", "source": "text",
              "link_text": null, "text_mismatch": false, "listed_by": [] } ],
  "attachments": [],
  "signals": { "lookalike_sender": true, "brand_impersonation": true, "credential_or_payment_language": true, … },
  "details": { "brand_terms_found": ["Zentrova"], "lookalike_domains": [ {"domain":"zentrova-login.com","similarity":94,"closest_term":"Zentrova"} ],
               "language_flags": ["verify your account","within 24 hours"], "url_count": 1, "listed_urls": [], "attachment_count": 0,
               "not_checked": [], "text_sample": "…" },
  "verdict": "Suspicious", "risk_score": 70, "risk_level": "High", "scoring": { "risk": { "rules": { … } }, "confidence": { … } },
  "review_status": "New", "review_note": null, "analysed_at": "…", "created_at": "…",
  "raw_url": "<time-limited download link of the original .eml>" }
```

### `GET /email/messages`
| Query | Meaning |
|---|---|
| `brand_id` (repeatable) | brands |
| `verdict` (repeatable) | `Likely phishing`, `Suspicious`, `Low risk` |
| `q` | text in subject, sender address or sender domain |
| `page`, `page_size` | paging |

List items omit `urls`, `attachments` and `details` (fetch one email for those).

---

## Social media

Finds posts, videos, ads, channels and accounts that use the brand, and scores each one for brand abuse (fake
customer care numbers, scam wording, the official logo, look-alike account names).

**Collection sources**
- **Apify** (paid; needs `APIFY_TOKEN`): Instagram, TikTok, Facebook, the Meta Ad Library, X and LinkedIn — full
  platform data. Each run costs Apify credit, capped by `APIFY_MAX_CHARGE_USD`; identical searches are cached for
  `APIFY_CACHE_MINUTES`.
- **Web search** (`web_search`, free): `site:` queries over the configured search provider (Brave / SerpAPI with a key,
  else DuckDuckGo, paced and possibly rate-limited) for YouTube, Instagram, Facebook, X/Twitter, Threads, TikTok,
  LinkedIn, Telegram, Pinterest, Reddit, Quora, WhatsApp channels, Snapchat and Medium. Brand-name queries first, then
  one query per scam theme (customer care, KYC, refund, jobs, lottery, investment, loans, APK) up to
  `SOCIAL_WEB_SEARCH_MAX_QUERIES` (20) and `SOCIAL_WEB_SEARCH_BUDGET_SECONDS`. Hits are search snippets (title +
  snippet only): `structured: false`, and they stay `stage: "Candidate"` (lower confidence). A provider that is down,
  not configured or rate-limited shows as `unavailable` / `not_configured` on the collection — never as "nothing found".
  A post found by both Apify and web search is kept once (the Apify copy).

**Analysis** runs automatically at the end of every collection for the items it stored (time budget
`SOCIAL_MEDIA_ANALYSIS_BUDGET_SECONDS`, 15 min; the rest stays pending), and on demand with
`POST /social-media/items/analyse`. Per item (same rules as the legacy backend):

1. **Official?** Posted by an official handle (brand allowlist `social_handle`) or a URL on an official domain →
   stored with `relevant: false` and not scored (hidden unless `include_official=true`).
2. **About the brand?** The brand name in the title/text/author (look-alike lettering such as 𝐙𝐞𝐧𝐭𝐫𝐨𝐯𝐚 is read too),
   a look-alike account name (≥ 85 % similar to an 8+ letter name; a 6–7 letter name also needs a brand word), the
   official logo in the thumbnail, or — for short brand names like "Navi" — the short name together with scam wording
   (a phone number alone is not enough: "Navi Mumbai" shops publish numbers too). Not about the brand → `relevant: false`, risk 0.
3. **Thumbnail / profile picture**: downloaded through the safe fetcher (≤ 2 MB), compared with the brand's official
   logos (the same logo matcher as phishing websites) and, for relevant items, stored as PNG evidence
   (`evidence/{brand}/social/…`).
4. **Scored** with the social media rules (see [Risk scoring](#risk-scoring)): brand_in_content 20,
   typo_similarity_gt_80 25 (accounts/channels only), social_image_match 20, scam_contact_details 30 (phone, WhatsApp,
   UPI — Telegram links are shown but not scored), fake_support_claim 30, scam_language 20, brand_abuse 15, paid_ad 10;
   then clamped into its tier: **Critical** = contact details + customer-care claim or scam wording; **High** =
   customer-care claim, scam wording, or brand abuse with the logo / a look-alike name; **Medium** = contact details,
   brand abuse, logo, ad or look-alike name alone; **Low** = the brand is only mentioned.

| Method | Path | Purpose |
|---|---|---|
| POST | `/social-media/collections` | start a collection (`202`) |
| GET | `/social-media/collections` | recent collections (`?brand_id=&limit=`) |
| GET | `/social-media/collections/{id}` | one collection with every Apify run and its cost |
| POST | `/social-media/collections/{id}/cancel` | stop it |
| GET | `/social-media/items` | **search analysed items** (riskiest first) |
| GET | `/social-media/items/{id}` | one item with every detail, the score breakdown and evidence links |
| POST | `/social-media/items/analyse` | (re-)analyse a brand's items now |
| PATCH | `/social-media/items/{id}/review` | analyst decision |
| GET | `/social-media/summary` | counts for dashboard cards |
| GET | `/social-media/apify/status` | is Apify configured, which sources run (plus the web-search source) |
| GET | `/social-media/apify/usage` | Apify runs and spend per source (`?days=30&brand_id=`) |

### `POST /social-media/collections`
```json
{ "brand_id": "…", "platforms": ["instagram", "x", "web_search"], "kinds": ["content"], "date_from": "2026-11-01", "date_to": "2026-11-23" }
```
`platforms`: `instagram`, `tiktok`, `facebook`, `meta_ads`, `x`, `linkedin` (Apify, enabled in `APIFY_PLATFORMS`) and
`web_search` (free, every platform). Default: all of them. `["web_search"]` alone runs no Apify actor.
`kinds`: `content` (posts/videos/ads) and/or `profiles` (accounts/channels); default both.
Searches use the brand's keywords plus scam phrases (`SOCIAL_MEDIA_SCAM_QUERIES`, e.g. "{brand} customer care number").

When finished, `components` lists each source (`Apify Instagram`, `Web search (social media)`, …) and each analysis
step (`Content analysis` with counts `analysed`, `relevant`, `flagged`, `official`; `Logo matching (thumbnails)` with
`compared`, `matched`, `thumbnails_failed` — `skipped` when the brand has no official logo). `stats.analysis` holds the
same numbers as `POST /items/analyse`. Items not analysed within the time budget make `Content analysis`
`unavailable` ("N items not analysed within the time budget") and the run `partially_completed`.

### The item object (`GET /social-media/items`)
```json
{
  "id": "…", "brand_id": "…", "scan_id": "…",
  "key": "instagram:post:scam1", "platform": "Instagram", "content_type": "post",
  "url": "https://www.instagram.com/p/SCAM1/", "item_id": "SCAM1",
  "title": "Zentrova Customer Care Number 9876543210 — refund in 5 minutes, pay to zentrova.help@ybl",
  "text": "…", "author": "zentrova_helpdesk", "author_handle": "zentrova_helpdesk",
  "author_url": "https://www.instagram.com/zentrova_helpdesk/", "author_id": null,
  "published_at": "2026-11-01T00:00:00.000Z",
  "thumbnail_url": "<time-limited link to the stored PNG copy, else the original URL>",
  "thumbnail_source_url": "https://cdn.example/scam1.jpg",
  "metrics": { "Views": null, "Likes": null, "Comments": null },
  "discovery": "Apify (Instagram)", "query": "Zentrova",
  "is_official": false, "first_seen": "…", "last_seen": "…", "times_seen": 1,

  "analysed_at": "…", "relevant": true,
  "risk_score": 100, "risk_level": "Critical", "confidence": 95, "confidence_level": "High",
  "stage": "Finding", "structured": true,
  "headline": "Brand used in Instagram post (fake contact details, fake customer care, official logo)",
  "reasons": ["fake contact details", "fake customer care", "official logo"],
  "signals": { "brand_in_content": true, "typo_similarity": null, "social_image_match": true, "scam_contact_details": true,
               "fake_support_claim": true, "scam_language": false, "brand_abuse": false, "paid_ad": false },
  "scam_contacts": { "phone": ["9876543210"], "upi": ["zentrova.help@ybl"] },
  "other_links": {},
  "scam_phrases": ["customer care", "care number", "refund"],
  "brand_terms": ["Zentrova"],
  "logo_match": true, "logo_match_score": 88,
  "logo_comparison": {
    "matched": true, "score": 88.4, "method": "shape", "source": "thumbnail",
    "checks": { "shape": 92, "design": 81, "colour": 90, "text": null },
    "inliers": 143, "inlier_ratio": 0.82, "box": [[12, 30], [400, 31], [399, 210], [11, 209]],
    "points": [[10, 12, 22, 41], …], "image_size": [480, 320], "logo_size": [600, 280],
    "text_found": null, "text_expected": null, "colours": { "logo": ["#0a3d91"], "found": ["#0b3e90"] },
    "reason": "Official logo found …",
    "found_image_url": "<signed link to the stored thumbnail>", "found_image_source": "https://cdn.example/scam1.jpg",
    "official_logo_url": "<signed link>", "official_logo_name": "logo.png", "candidates": []
  },
  "review_status": "New", "review_note": null, "reviewed_at": null, "reviewed_by": null
}
```
- `relevant`: `true` about the brand, `false` analysed and not about it (or an official item), `null` not analysed yet.
  Items that are not relevant have `risk_score` 0, no `headline` and no `reasons`.
- `stage`: `Finding` (platform data or a stored thumbnail) or `Candidate` (web-search snippet only); `null` before analysis.
- `reasons` (chips): `fake contact details`, `fake customer care`, `scam wording`, `brand abuse`, `official logo`.
- `scam_contacts` keys: `phone`, `whatsapp`, `upi` (scored); `other_links` keys: `telegram` (shown, not scored).
- `logo_comparison`: same shape as on phishing results (`source: "thumbnail"`); `null` when no thumbnail was compared
  (no thumbnail, download failed, or the brand has no official logo). The box/points are in the stored PNG's pixels.

### `GET /social-media/items` — search items
Sorted riskiest first by default. Paged (`page`, `page_size`).

| Query | Meaning |
|---|---|
| `brand_id` (repeatable) | brands |
| `platform` (repeatable) | e.g. `instagram`, `YouTube`, `meta_ads` (case and punctuation ignored) |
| `content_type` (repeatable) | `video`, `post`, `ad`, `channel`, `account` |
| `risk_level` (repeatable) | Low, Medium, High, Critical |
| `min_risk` | 0–100 |
| `flagged_only` | `true` = risk Medium or above (score ≥ 30) |
| `relevant` | `true` (default) = about the brand or not analysed yet; `false` = analysed and not about the brand; `all` |
| `review_status` (repeatable) | any review status |
| `logo_match` | `true` / `false` = official logo found in the thumbnail |
| `q` | text in title, text, author name, handle or URL |
| `scan_id` | items last seen by one collection |
| `include_official` | `true` to include the brand's own accounts (hidden by default) |
| `sort` | `risk` (default), `recent` (last seen), `published`, `first_seen` (`last_seen` = `recent`) |

### `GET /social-media/items/{id}`
The item object plus:
- `details` — every output field: `Platform`, `Content Type`, `Title`, `Author`, `Author URL`, `URL`, `Published`,
  `Views`, `Likes`, `Comments` (+ other metrics), `Brand Terms`, `Name Similarity`, `Logo Match`, `Logo Match Score`,
  `Scam Contacts` (`["phone: 9876543210", …]`), `Other Links`, `Contacts`, `Scam Phrases`, `Text Excerpt`,
  `Thumbnail URL`, `Discovery Source`, `Found By Search`, `Structured Data`, `Stage`, `Risk`
  (official items: `{ "Official": true, "Skipped Because": "…" }`).
- `scoring` — `{ "risk": { "score", "level", "raw_score", "tier", "rules": { "scam_contact_details": 30, … }, "policy" }, "confidence": { "score", "level", "factors": [ … ] } }`.
- `evidence` — `[{ "kind": "image", "content_type": "image/png", "url": "<time-limited link>", "meta": { "url": "<original>", "role": "thumbnail", "matched": true, "logo_match_score": 88.4, "image_size": [480, 320] } }]`.

### `POST /social-media/items/analyse`
```json
{ "brand_id": "…", "only_pending": false }
```
Analyses the brand's items now, oldest analysis first (`only_pending: true` = only items never analysed), for at most
`SOCIAL_MEDIA_ANALYSE_REQUEST_SECONDS` (120 s). Analyst decisions are kept. Unknown brand → `404`.
```json
{ "brand_id": "…", "analysed": 5, "relevant": 2, "flagged": 2, "official_skipped": 2,
  "by_level": { "Low": 0, "Medium": 0, "High": 0, "Critical": 2 },
  "images": { "downloaded": 2, "failed": 0, "compared": 2, "matched": 1, "stored": 1 },
  "remaining": 0, "failed": 0, "duration_seconds": 1.4 }
```
`remaining` > 0: the time budget ran out — call again to continue.

### `PATCH /social-media/items/{id}/review`
```json
{ "status": "Confirmed Threat", "note": "Reported to Instagram" }
```
Same statuses and rule as phishing results: New, Investigating, Confirmed Threat, False Positive, Legitimate, Ignored,
Resolved; a note is required for False Positive, Legitimate and Ignored (`422` otherwise). Returns the full item.
Later collections and re-analysis refresh the facts and score but keep the decision.

### `GET /social-media/summary?brand_id=…`
Small payload for dashboard cards (`brand_id` optional = all brands). Counts cover non-official items that are
relevant or not yet analysed.
```json
{
  "brand_id": "…",
  "collected": 3, "relevant": 2, "flagged": 2, "pending_analysis": 0, "logo_matches": 1,
  "by_platform": [
    { "platform": "Instagram", "Low": 0, "Medium": 0, "High": 0, "Critical": 1, "total": 1 },
    { "platform": "YouTube", "Low": 0, "Medium": 0, "High": 0, "Critical": 1, "total": 1 }
  ],
  "by_risk_level": { "Low": 0, "Medium": 0, "High": 0, "Critical": 2, "total": 2 },
  "by_content_type": [ { "content_type": "post", "total": 1, "flagged": 1 }, { "content_type": "video", "total": 1, "flagged": 1 } ],
  "by_reason": [ { "reason": "fake contact details", "count": 2 }, { "reason": "fake customer care", "count": 2 }, { "reason": "official logo", "count": 1 } ],
  "by_review_status": { "New": 1, "Confirmed Threat": 1 },
  "last_collection": { "id": "…", "status": "completed", "started_at": "…", "finished_at": "…", "created_at": "…" },
  "last_seen": "…", "last_analysed": "…"
}
```
`flagged` = relevant with risk Medium or above (score ≥ 30); `by_review_status` counts flagged items only.

### `GET /social-media/apify/status`
Apify configuration, account, limits and every Apify source, plus `web_search`:
`{ "name": "Web search (social media)", "platform": "web_search", "kind": "content+profiles", "actor": "<provider>", "enabled": true, "reason": null }`.

---

## Health

No token needed; not under `/api/v1`.

- `GET /health/live` → `200` while the process is running (for container liveness checks).
- `GET /health/ready` → `200` when Postgres and Redis respond; `503` with the failing part otherwise (for load balancers).

---

## Quick start (curl)

```bash
API=http://localhost:8020/api/v1
T=$(curl -s -X POST $API/auth/login -H 'content-type: application/json' \
      -d '{"email":"admin@example.com","password":"<password>"}' | jq -r .access_token)

# 1. find or create the brand, then add its details
curl -s "$API/brands/search?q=zentrova" -H "Authorization: Bearer $T"
BRAND=$(curl -s -X POST $API/brands -H "Authorization: Bearer $T" -H 'content-type: application/json' \
          -d '{"name":"Zentrova Bank","keywords":["Zentrova"]}' | jq -r .id)
curl -s -X POST $API/brands/$BRAND/details -H "Authorization: Bearer $T" -H 'content-type: application/json' \
     -d '{"domains":["zentrova.com"],"email_domains":["zentrovamail.com"],"social_handles":["@ZentrovaBank"]}'

# 2. phishing websites: one link now, or a full scan
curl -s -X POST $API/phishing/check -H "Authorization: Bearer $T" -H 'content-type: application/json' \
     -d "{\"brand_id\":\"$BRAND\",\"domain\":\"https://zentrova-login.com/\"}"
SCAN=$(curl -s -X POST $API/phishing/scans -H "Authorization: Bearer $T" -H 'content-type: application/json' \
         -d "{\"brand_id\":\"$BRAND\"}" | jq -r .id)
curl -s $API/phishing/scans/$SCAN -H "Authorization: Bearer $T"            # poll until finished
curl -s "$API/phishing/domains?brand_id=$BRAND&suspected=true" -H "Authorization: Bearer $T"

# 3. email: own-domain security, then a suspicious email
curl -s -X POST $API/email/posture/check -H "Authorization: Bearer $T" -H 'content-type: application/json' -d "{\"brand_id\":\"$BRAND\"}"
curl -s -X POST $API/email/messages -H "Authorization: Bearer $T" -F brand_id=$BRAND -F file=@suspicious.eml

# 4. social media (Apify needs APIFY_TOKEN; "web_search" is free)
curl -s -X POST $API/social-media/collections -H "Authorization: Bearer $T" -H 'content-type: application/json' -d "{\"brand_id\":\"$BRAND\"}"
curl -s "$API/social-media/items?brand_id=$BRAND&flagged_only=true" -H "Authorization: Bearer $T"
curl -s "$API/social-media/summary?brand_id=$BRAND" -H "Authorization: Bearer $T"
```

---

## Not in this version yet

These parts of the old Python backend are planned and not ported yet:
- Logo matching on **JavaScript-rendered images** (screenshots are taken, but logo matching still uses the page HTML:
  img/srcset/lazy/og/CSS/inline-SVG images).
- WHOIS/RDAP registration age (`young_domain`), Common Crawl and CertStream discovery.
- Findings correlation across modules; apps and documents modules. Browser screenshots of social posts.
- **Email**: ClamAV / YARA attachment scanning, Rspamd, AbuseIPDB, mailbox intake and DMARC aggregate reports.
- Automatic (scheduled) scans.
