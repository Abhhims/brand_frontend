/** HTTP layer for social media monitoring: read the validated request, call the service, set the status code. */
import type { FastifyReply, FastifyRequest } from "fastify"
import { currentUser } from "../auth/auth.guards.js"
import type { AnalyseInput, ItemsQuery, ListCollectionsQuery, ReviewInput, StartCollectionInput, SummaryQuery, UsageQuery } from "./social-media.dto.js"
import type { SocialMediaService } from "./social-media.service.js"

type Id = { Params: { id: string } }

export class SocialMediaController {
  constructor(private readonly service: SocialMediaService) {}

  startCollection = async (request: FastifyRequest<{ Body: StartCollectionInput }>, reply: FastifyReply) => {
    const run = await this.service.startCollection(request.body, "manual")
    return reply.status(202).send(run)
  }

  listCollections = async (request: FastifyRequest<{ Querystring: ListCollectionsQuery }>) => this.service.listCollections(request.query)

  getCollection = async (request: FastifyRequest<Id>) => this.service.getCollection(request.params.id)

  cancelCollection = async (request: FastifyRequest<Id>) => this.service.cancelCollection(request.params.id)

  listItems = async (request: FastifyRequest<{ Querystring: ItemsQuery }>) => this.service.listItems(request.query)

  getItem = async (request: FastifyRequest<Id>) => this.service.getItem(request.params.id)

  analyseItems = async (request: FastifyRequest<{ Body: AnalyseInput }>) => this.service.analyseItems(request.body)

  reviewItem = async (request: FastifyRequest<Id & { Body: ReviewInput }>) =>
    this.service.reviewItem(request.params.id, request.body, currentUser(request).email)

  summary = async (request: FastifyRequest<{ Querystring: SummaryQuery }>) => this.service.summary(request.query)

  apifyStatus = async () => this.service.apifyStatus()

  usage = async (request: FastifyRequest<{ Querystring: UsageQuery }>) => this.service.usage(request.query)
}
