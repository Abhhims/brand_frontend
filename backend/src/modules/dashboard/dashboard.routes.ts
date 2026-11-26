/**
 * Dashboard endpoints (prefix /api/v1/dashboard). Signed-in users. Real data only (social media items).
 *
 *   GET /overview    every dashboard number for the filters (brand, risk, reason, period)
 *   GET /breakdown   explorer: by reason, content type or platform, with a trend
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import type { FastifyRequest } from "fastify"
import { ErrorDto } from "../../common/dto.js"
import type { Db } from "../../infra/db.js"
import type { Guards } from "../auth/auth.guards.js"
import { BreakdownDto, BreakdownQueryDto, breakdownHandler } from "./breakdown.js"
import { OverviewDto, OverviewQueryDto, type OverviewQuery } from "./dashboard.dto.js"
import type { DashboardService } from "./dashboard.service.js"

export class DashboardController {
  constructor(private readonly service: DashboardService) {}
  overview = async (request: FastifyRequest<{ Querystring: OverviewQuery }>) => this.service.overview(request.query)
}

export const dashboardRoutes =
  (c: DashboardController, guards: Guards, db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", guards.user)
    const tags = ["dashboard"]
    const security = [{ bearer: [] }]
    app.get(
      "/overview",
      {
        schema: {
          tags,
          security,
          summary: "Dashboard overview",
          description:
            "Social media items about the brand: open by risk, new per day (stacked by risk) vs the previous period, confirmed threats, median time to decision, false-positive rate, review workflow, reasons (fake contact details, fake customer care, scam wording, brand abuse, official logo), content types, per-brand pressure, collection coverage gaps and the riskiest open items. Cached 30 s.",
          querystring: OverviewQueryDto,
          response: { 200: OverviewDto, 401: ErrorDto },
        },
      },
      c.overview,
    )
    app.get(
      "/breakdown",
      {
        schema: {
          tags,
          security,
          summary: "Social media breakdown",
          description:
            "Social media items grouped by reason, content type or platform, split by risk, with a daily trend.",
          querystring: BreakdownQueryDto,
          response: { 200: BreakdownDto, 401: ErrorDto },
        },
      },
      breakdownHandler(db),
    )
  }
