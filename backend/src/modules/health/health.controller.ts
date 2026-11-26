/**
 * Controller layer: HTTP only. Reads the (already validated) request, calls the service, picks the status code.
 * No database access and no business rules here.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import type { HealthService } from "./health.service.js"

export class HealthController {
  constructor(private readonly service: HealthService) {}

  live = async () => this.service.live()

  ready = async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await this.service.readiness()
    return reply.status(result.status === "ok" ? 200 : 503).send(result)
  }
}
