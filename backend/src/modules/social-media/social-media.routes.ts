/**
 * Social media monitoring endpoints (prefix /api/v1/social-media). All require a signed-in user.
 *
 *   POST /collections               start an Apify collection for a brand (202, runs in the background)
 *   GET  /collections               recent collections (scan runs), newest first
 *   GET  /collections/:id           one collection with every Apify run and its cost
 *   POST /collections/:id/cancel    stop a queued/running collection
 *   GET  /items                     collected posts/videos/ads/accounts with risk, filtered and paginated (riskiest first)
 *   GET  /items/:id                 one item with every detail, the score breakdown and evidence links
 *   POST /items/analyse             (re-)analyse a brand's items now; returns counts
 *   PATCH /items/:id/review         analyst decision
 *   GET  /summary                   counts for dashboard cards (platform × risk level, content type, reason…)
 *   GET  /apify/status              is Apify configured, which sources run, current limits
 *   GET  /apify/usage               Apify runs and spend per source over the last N days
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { ErrorDto } from "../../common/dto.js"
import type { Guards } from "../auth/auth.guards.js"
import type { SocialMediaController } from "./social-media.controller.js"
import {
  AnalyseDto,
  AnalyseResultDto,
  ApifyStatusDto,
  CollectionDetailDto,
  CollectionDto,
  IdParamDto,
  ItemsQueryDto,
  ListCollectionsQueryDto,
  ReviewDto,
  SocialItemDetailDto,
  SocialItemPageDto,
  StartCollectionDto,
  SummaryDto,
  SummaryQueryDto,
  UsageDto,
  UsageQueryDto,
} from "./social-media.dto.js"

const tags = ["social-media"]
const security = [{ bearer: [] }]
const errors = { 400: ErrorDto, 401: ErrorDto, 404: ErrorDto }

export const socialMediaRoutes =
  (c: SocialMediaController, guards: Guards): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", guards.user)

    app.post("/collections", { schema: { tags, security, body: StartCollectionDto, response: { 202: CollectionDto, ...errors } } }, c.startCollection)
    app.get("/collections", { schema: { tags, security, querystring: ListCollectionsQueryDto, response: { 200: z.array(CollectionDto) } } }, c.listCollections)
    app.get("/collections/:id", { schema: { tags, security, params: IdParamDto, response: { 200: CollectionDetailDto, ...errors } } }, c.getCollection)
    app.post("/collections/:id/cancel", { schema: { tags, security, params: IdParamDto, response: { 200: CollectionDto, ...errors } } }, c.cancelCollection)
    app.get("/items", { schema: { tags, security, querystring: ItemsQueryDto, response: { 200: SocialItemPageDto } } }, c.listItems)
    app.post(
      "/items/analyse",
      { schema: { tags, security, summary: "(Re-)analyse a brand's collected items now", body: AnalyseDto, response: { 200: AnalyseResultDto, ...errors } } },
      c.analyseItems,
    )
    app.get("/items/:id", { schema: { tags, security, params: IdParamDto, response: { 200: SocialItemDetailDto, ...errors } } }, c.getItem)
    app.patch(
      "/items/:id/review",
      { schema: { tags, security, summary: "Analyst decision on an item", params: IdParamDto, body: ReviewDto, response: { 200: SocialItemDetailDto, ...errors, 422: ErrorDto } } },
      c.reviewItem,
    )
    app.get("/summary", { schema: { tags, security, summary: "Counts for dashboard cards", querystring: SummaryQueryDto, response: { 200: SummaryDto, ...errors } } }, c.summary)
    app.get("/apify/status", { schema: { tags, security, response: { 200: ApifyStatusDto } } }, c.apifyStatus)
    app.get("/apify/usage", { schema: { tags, security, querystring: UsageQueryDto, response: { 200: UsageDto } } }, c.usage)
  }
