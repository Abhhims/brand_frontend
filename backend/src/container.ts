/**
 * Composition root (like a Spring application context, but explicit). The one place that creates
 * integrations, repositories, services and controllers, and passes each its dependencies through the constructor.
 *
 *   Repository(db) → Service(repositories, integrations, cache, queue) → Controller(service)
 *
 * Classes never import each other's instances, so a test can build any service with fake dependencies.
 * Adding a module = construct its classes here and register its routes in app.ts.
 */
import { env } from "./config/env.js"
import { cache } from "./infra/cache.js"
import { db, dbRead, pool } from "./infra/db.js"
import { getQueue } from "./infra/queue.js"
import { redis } from "./infra/redis.js"
import { ApifyClient } from "./integrations/apify/apify.client.js"
import { ApifyRunner } from "./integrations/apify/apify.runner.js"
import { SafeFetcher } from "./integrations/http/safe-fetch.js"
import { ObjectStorage } from "./integrations/storage/object-storage.js"
import { LogoMatcher } from "./integrations/vision/logo-matcher.js"
import { AuthController } from "./modules/auth/auth.controller.js"
import { createGuards } from "./modules/auth/auth.guards.js"
import { AuthService } from "./modules/auth/auth.service.js"
import { BrandsController } from "./modules/brands/brands.controller.js"
import { BrandsRepository } from "./modules/brands/brands.repository.js"
import { BrandsService } from "./modules/brands/brands.service.js"
import { LogoTemplates } from "./modules/brands/logo-templates.js"
import { DashboardRepository } from "./modules/dashboard/dashboard.repository.js"
import { DashboardController } from "./modules/dashboard/dashboard.routes.js"
import { DashboardService } from "./modules/dashboard/dashboard.service.js"
import { HealthController } from "./modules/health/health.controller.js"
import { HealthRepository } from "./modules/health/health.repository.js"
import { HealthService } from "./modules/health/health.service.js"
import { ScansRepository } from "./modules/scans/scans.repository.js"
import { SocialMediaController } from "./modules/social-media/social-media.controller.js"
import { SocialMediaRepository } from "./modules/social-media/social-media.repository.js"
import { SocialAnalyser } from "./modules/social-media/analysis/social-analyser.js"
import { SocialMediaService } from "./modules/social-media/social-media.service.js"
import { ApifyCollector } from "./modules/social-media/sources/apify/apify.collector.js"
import type { ApifySettings } from "./modules/social-media/sources/apify/apify.sources.js"
import { UsersRepository } from "./modules/users/users.repository.js"

const apifySettings: ApifySettings = {
  enabledPlatforms: env.APIFY_PLATFORMS,
  itemsPerQuery: env.APIFY_ITEMS_PER_QUERY,
  scamQueryCount: env.APIFY_SCAM_QUERIES,
  scamTemplates: env.SOCIAL_MEDIA_SCAM_QUERIES,
  lookbackDays: env.SOCIAL_MEDIA_LOOKBACK_DAYS,
  scamLookbackDays: env.SOCIAL_MEDIA_SCAM_LOOKBACK_DAYS,
  actors: {
    instagram: env.APIFY_ACTOR_INSTAGRAM,
    instagramPosts: env.APIFY_ACTOR_INSTAGRAM_POSTS,
  },
}

/** Optional replacements, used by tests (e.g. a fake Apify runner) */
export interface ContainerOverrides {
  apifyRunner?: ApifyRunner
  apifyClient?: ApifyClient
  apifyConfigured?: boolean
  storage?: ObjectStorage
  fetcher?: SafeFetcher
  /** null = no logo matching (official logos are never prepared) */
  logoMatcher?: LogoMatcher | null
}

export function createContainer(overrides: ContainerOverrides = {}) {
  // integrations (external APIs)
  const apifyClient = overrides.apifyClient ?? new ApifyClient(env.APIFY_TOKEN, env.APIFY_MAX_CHARGE_USD)
  const apifyRunner =
    overrides.apifyRunner ??
    new ApifyRunner(apifyClient, redis, {
      runTimeoutSeconds: env.APIFY_RUN_TIMEOUT_SECONDS,
      cacheMinutes: env.APIFY_CACHE_MINUTES,
      keyPrefix: env.REDIS_KEY_PREFIX,
    })

  const storage =
    overrides.storage ??
    new ObjectStorage({
      endpoint: env.S3_ENDPOINT_URL,
      publicEndpoint: env.S3_PUBLIC_ENDPOINT_URL,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      urlExpireSeconds: env.S3_URL_EXPIRE_SECONDS,
    })

  const fetcher =
    overrides.fetcher ??
    new SafeFetcher(
      {
        userAgent: env.FETCH_USER_AGENT,
        timeoutMs: env.FETCH_TIMEOUT_SECONDS * 1000,
        maxBytes: env.FETCH_MAX_BYTES,
        maxRedirects: env.FETCH_MAX_REDIRECTS,
        perHostPerMinute: env.FETCH_PER_HOST_PER_MINUTE,
        allowPrivateHosts: env.FETCH_ALLOW_PRIVATE_HOSTS.map((h) => h.toLowerCase()),
        keyPrefix: env.REDIS_KEY_PREFIX,
      },
      redis,
    )

  // repositories
  const repositories = {
    health: new HealthRepository(pool, redis),
    users: new UsersRepository(db),
    brands: new BrandsRepository(db),
    scans: new ScansRepository(db),
    socialMedia: new SocialMediaRepository(db, dbRead),
    dashboard: new DashboardRepository(dbRead),
  }

  // services
  const auth = new AuthService(repositories.users, { jwtSecret: env.JWT_SECRET, jwtExpireMinutes: env.JWT_EXPIRE_MINUTES })
  const collector = new ApifyCollector(apifyRunner, apifySettings, overrides.apifyConfigured ?? apifyClient.configured)
  // official logos prepared once per brand, compared with social media thumbnails
  const logoMatcher = overrides.logoMatcher === undefined ? new LogoMatcher() : overrides.logoMatcher
  const logoTemplates = new LogoTemplates(repositories.brands, storage, logoMatcher)

  const services = {
    health: new HealthService(repositories.health),
    auth,
    brands: new BrandsService(repositories.brands, storage),
    dashboard: new DashboardService(repositories.dashboard, (key, ttl, compute) => cache.getOrSet(key, ttl, compute)),
    socialMedia: new SocialMediaService(
      repositories.socialMedia,
      repositories.scans,
      repositories.brands,
      collector,
      apifyClient,
      async (name, data, opts) => {
        await getQueue("default").add(name, data, opts)
      },
      (key, ttl, compute) => cache.getOrSet(key, ttl, compute),
      {
        itemsPerQuery: env.APIFY_ITEMS_PER_QUERY,
        scamQueryCount: env.APIFY_SCAM_QUERIES,
        maxChargeUsd: env.APIFY_MAX_CHARGE_USD,
        runTimeoutSeconds: env.APIFY_RUN_TIMEOUT_SECONDS,
        cacheMinutes: env.APIFY_CACHE_MINUTES,
        analysisBudgetSeconds: env.SOCIAL_MEDIA_ANALYSIS_BUDGET_SECONDS,
        analyseRequestSeconds: env.SOCIAL_MEDIA_ANALYSE_REQUEST_SECONDS,
        analysisConcurrency: env.SOCIAL_MEDIA_ANALYSIS_CONCURRENCY,
      },
      {
        analyser: new SocialAnalyser(fetcher, storage, logoMatcher),
        logos: logoTemplates,
        storage,
      },
    ),
  }

  // controllers + route guards
  const controllers = {
    health: new HealthController(services.health),
    auth: new AuthController(services.auth),
    brands: new BrandsController(services.brands),
    socialMedia: new SocialMediaController(services.socialMedia),
    dashboard: new DashboardController(services.dashboard),
  }
  const guards = createGuards(services.auth)

  return { repositories, services, controllers, guards }
}

export type Container = ReturnType<typeof createContainer>
