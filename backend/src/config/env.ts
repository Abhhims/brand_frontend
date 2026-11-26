/**
 * The only place that reads process.env. Every setting is validated once at startup, so a missing or
 * malformed value stops the process with a clear message instead of failing later at 3 a.m.
 * Empty values ("FOO=") count as unset and fall back to the default, as in the legacy backend.
 */
import { z } from "zod"

const bool = z
  .enum(["true", "false", "1", "0", "yes", "no"])
  .transform((v) => v === "true" || v === "1" || v === "yes")
const list = z.string().transform((v) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)
const optional = z.string().min(1).optional()

const schema = z.object({
  // ---------------------------------------------------------------- runtime
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8020),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Comma-separated browser origins allowed to call the API */
  CORS_ORIGINS: list.default(["http://localhost:3000", "http://localhost:3001"]),
  /** Number of proxies in front of the API (load balancer = 1); needed for correct client IPs in rate limits */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  /** Per client IP, per minute, across all API instances (counted in Redis) */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
  API_DOCS_ENABLED: bool.default(true),

  // ---------------------------------------------------------------- Postgres
  DATABASE_URL: z.string().url().default("postgres://brandintel:brandintel@localhost:5433/brandintel"),
  /** Optional read replica for heavy list/stats queries; falls back to DATABASE_URL */
  DATABASE_READ_URL: optional,
  /** Connections per process. Total = processes × this; keep under Postgres max_connections (or use PgBouncer) */
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  /** Kill any single query running longer than this, so one bad query cannot pin the pool */
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // ---------------------------------------------------------------- Redis
  REDIS_URL: z.string().default("redis://localhost:6380/0"),
  /** Prefix for every cache/rate-limit key, so several environments can share one Redis safely */
  REDIS_KEY_PREFIX: z.string().default("bi:"),
  CACHE_DEFAULT_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  // ---------------------------------------------------------------- queues / workers
  QUEUE_PREFIX: z.string().default("bi"),
  /** Jobs each worker process runs at once, per queue */
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  /** Queues this worker process serves, comma-separated: default, browser, system (browser has no jobs right now) */
  WORKER_QUEUES: list.default(["default", "browser", "system"]),

  // ---------------------------------------------------------------- object storage (S3-compatible: MinIO, AWS S3, …)
  /** Brand assets and evidence files live here, never in Postgres */
  S3_ENDPOINT_URL: z.string().url().default("http://localhost:9100"),
  /** Host used in download links given to browsers, when it differs from the one the API uses */
  S3_PUBLIC_ENDPOINT_URL: z.string().url().optional(),
  S3_ACCESS_KEY: z.string().default("brandintel"),
  S3_SECRET_KEY: z.string().default("brandintel-secret"),
  S3_BUCKET: z.string().default("evidence"),
  S3_REGION: z.string().default("us-east-1"),
  /** How long a download link stays valid */
  S3_URL_EXPIRE_SECONDS: z.coerce.number().int().positive().default(3600),

  // ---------------------------------------------------------------- auth
  JWT_SECRET: z.string().default("change-me-in-production"),
  JWT_EXPIRE_MINUTES: z.coerce.number().int().positive().default(720),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().default("ChangeMe!2026"),

  // ---------------------------------------------------------------- Apify (paid Instagram scrapers)
  /** console.apify.com → Settings → API & Integrations. Without it every Apify source reports "not configured". */
  APIFY_TOKEN: optional,
  /** Platforms to search via Apify (only instagram is supported) */
  APIFY_PLATFORMS: list.default(["instagram"]),
  /** Results per search query (cost control: Apify bills per result) */
  APIFY_ITEMS_PER_QUERY: z.coerce.number().int().positive().default(20),
  /** How many of the scam queries (below) are also searched on Apify */
  APIFY_SCAM_QUERIES: z.coerce.number().int().min(0).default(3),
  /** Hard cost cap per actor run, in USD */
  APIFY_MAX_CHARGE_USD: z.coerce.number().positive().default(0.5),
  /** Time budget shared by all runs of one source; unfinished runs are aborted */
  APIFY_RUN_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  /** Identical searches within this window reuse the cached result instead of paying again (0 = off) */
  APIFY_CACHE_MINUTES: z.coerce.number().int().min(0).default(180),
  APIFY_ACTOR_INSTAGRAM: z.string().default("apify/instagram-scraper"),
  APIFY_ACTOR_INSTAGRAM_POSTS: z.string().default("apify/instagram-hashtag-scraper"),

  // ---------------------------------------------------------------- social media monitoring
  /** How far back brand-name searches look */
  SOCIAL_MEDIA_LOOKBACK_DAYS: z.coerce.number().int().positive().default(730),
  /** How far back scam searches look */
  SOCIAL_MEDIA_SCAM_LOOKBACK_DAYS: z.coerce.number().int().positive().default(730),
  /** Scam searches; {brand} becomes the brand's shortest name. Comma-separated. */
  SOCIAL_MEDIA_SCAM_QUERIES: list.default([
    "{brand} customer care number",
    "{brand} helpline number",
    "{brand} kyc update",
    "{brand} loan fraud",
    "{brand} refund",
  ]),
  /** Analysis of the items a collection stored stops after this many seconds; the rest is analysed on the next call */
  SOCIAL_MEDIA_ANALYSIS_BUDGET_SECONDS: z.coerce.number().int().positive().default(900),
  /** Time budget of one POST /social-media/items/analyse request */
  SOCIAL_MEDIA_ANALYSE_REQUEST_SECONDS: z.coerce.number().int().positive().default(120),
  /** Items analysed at the same time (thumbnail download + logo comparison) */
  SOCIAL_MEDIA_ANALYSIS_CONCURRENCY: z.coerce.number().int().positive().default(4),

  // ---------------------------------------------------------------- outbound HTTP (safe fetcher: thumbnail downloads)
  FETCH_USER_AGENT: z
    .string()
    .default("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
  FETCH_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(15),
  /** largest response body read, in bytes (pages bigger than this are cut off as an error) */
  FETCH_MAX_BYTES: z.coerce.number().int().positive().default(3 * 1024 * 1024),
  FETCH_MAX_REDIRECTS: z.coerce.number().int().min(0).default(5),
  /** requests per website per minute, shared by every worker */
  FETCH_PER_HOST_PER_MINUTE: z.coerce.number().int().positive().default(120),
  /** hosts allowed to resolve to private addresses (local test fixtures only; never in production) */
  FETCH_ALLOW_PRIVATE_HOSTS: list.default([]),
})

export type Env = z.infer<typeof schema>

function load(): Env {
  // Treat empty strings as unset
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""))
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  const env = parsed.data
  if (env.NODE_ENV === "production") {
    const problems = [
      env.JWT_SECRET === "change-me-in-production" && "JWT_SECRET is the default",
      env.JWT_SECRET.length < 32 && "JWT_SECRET is shorter than 32 characters",
      env.BOOTSTRAP_ADMIN_PASSWORD === "ChangeMe!2026" && "BOOTSTRAP_ADMIN_PASSWORD is the default",
      env.S3_SECRET_KEY === "brandintel-secret" && "S3_SECRET_KEY is the default",
    ].filter(Boolean)
    if (problems.length) throw new Error(`Insecure production configuration: ${problems.join("; ")}`)
  }
  return Object.freeze(env)
}

export const env = load()

export const apifyConfigured = Boolean(env.APIFY_TOKEN)
