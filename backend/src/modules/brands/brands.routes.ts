/**
 * Brand endpoints (prefix /api/v1/brands). Reading needs a signed-in user; changing needs an admin (as in legacy).
 *
 *   GET    /                          all brands, by name, with assets and allowlist
 *   GET    /search                    search brands by text (name, keyword, domain, handle…) + filters, paged
 *   POST   /:id/details               add keywords, domains, email domains, social handles, apps… in one call (admin)
 *   POST   /                          create (admin)                         201 / 409 duplicate name
 *   GET    /:id                       one brand
 *   PATCH  /:id                       change only the fields sent (admin)
 *   DELETE /:id                       delete with everything that belongs to it (admin)   204
 *   POST   /:id/assets                upload an official image, multipart kind + file (admin)   201 / 413 / 422
 *   DELETE /:id/assets/:assetId       (admin)   204
 *   GET    /:id/allowlist             official domains, packages, handles…
 *   POST   /:id/allowlist             add one, normalised (admin)            201 / 409 duplicate
 *   DELETE /:id/allowlist/:allowId    (admin)   204
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"
import { ErrorDto } from "../../common/dto.js"
import type { Guards } from "../auth/auth.guards.js"
import type { BrandsController } from "./brands.controller.js"
import {
  AllowDto,
  AllowInDto,
  AddDetailsDto,
  AddDetailsResultDto,
  AllowParamDto,
  AssetDto,
  AssetParamDto,
  BrandDto,
  BrandIdParamDto,
  BrandSearchPageDto,
  CreateBrandDto,
  SearchBrandsQueryDto,
  UpdateBrandDto,
} from "./brands.dto.js"

const tags = ["brands"]
const security = [{ bearer: [] }]
const e = { 401: ErrorDto, 403: ErrorDto, 404: ErrorDto }

export const brandRoutes =
  (c: BrandsController, guards: Guards): FastifyPluginAsyncZod =>
  async (app) => {
    const user = { preHandler: guards.user }
    const admin = { preHandler: guards.admin }

    app.get("/", { ...user, schema: { tags, security, summary: "List every brand", response: { 200: z.array(BrandDto), ...e } } }, c.list)
    // registered before /:id so "search" is never read as an id
    app.get(
      "/search",
      {
        ...user,
        schema: {
          tags,
          security,
          summary: "Search brands",
          description:
            "Free-text search (q) across brand name, description, keywords, product terms and every allowlist value (official domains, email domains, social handles, app packages, publishers). Each result says where the text matched (matched_on).",
          querystring: SearchBrandsQueryDto,
          response: { 200: BrandSearchPageDto, ...e },
        },
      },
      c.search,
    )
    app.post("/", { ...admin, schema: { tags, security, body: CreateBrandDto, response: { 201: BrandDto, 409: ErrorDto, ...e } } }, c.create)
    app.get("/:id", { ...user, schema: { tags, security, params: BrandIdParamDto, response: { 200: BrandDto, ...e } } }, c.get)
    app.patch(
      "/:id",
      { ...admin, schema: { tags, security, params: BrandIdParamDto, body: UpdateBrandDto, response: { 200: BrandDto, 409: ErrorDto, ...e } } },
      c.update,
    )
    app.delete("/:id", { ...admin, schema: { tags, security, params: BrandIdParamDto, response: { 204: z.null(), ...e } } }, c.delete)

    app.post(
      "/:id/assets",
      {
        ...admin,
        schema: {
          tags,
          security,
          consumes: ["multipart/form-data"],
          params: BrandIdParamDto,
          response: { 201: AssetDto, 413: ErrorDto, 422: ErrorDto, ...e },
        },
      },
      c.uploadAsset,
    )
    app.delete("/:id/assets/:assetId", { ...admin, schema: { tags, security, params: AssetParamDto, response: { 204: z.null(), ...e } } }, c.deleteAsset)

    app.get("/:id/allowlist", { ...user, schema: { tags, security, params: BrandIdParamDto, response: { 200: z.array(AllowDto), ...e } } }, c.listAllow)
    app.post(
      "/:id/details",
      {
        ...admin,
        schema: {
          tags,
          security,
          summary: "Add details to a brand",
          description:
            "Adds keywords, product terms, official domains, email domains, social handles, app packages, publishers and signing certificates in one call. Nothing is removed; duplicates and unreadable values are returned in skipped with a reason.",
          params: BrandIdParamDto,
          body: AddDetailsDto,
          response: { 200: AddDetailsResultDto, ...e },
        },
      },
      c.addDetails,
    )
    app.post(
      "/:id/allowlist",
      { ...admin, schema: { tags, security, params: BrandIdParamDto, body: AllowInDto, response: { 201: AllowDto, 409: ErrorDto, ...e } } },
      c.addAllow,
    )
    app.delete(
      "/:id/allowlist/:allowId",
      { ...admin, schema: { tags, security, params: AllowParamDto, response: { 204: z.null(), ...e } } },
      c.deleteAllow,
    )
  }
