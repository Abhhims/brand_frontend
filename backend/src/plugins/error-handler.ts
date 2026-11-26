/**
 * One error format for the whole API: { "detail": "<message>" } with the right status code.
 * Validation errors list each bad field. Unexpected errors are logged with the request id and the client
 * only sees a generic 500, so internals never leak.
 */
import fp from "fastify-plugin"
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod"
import { AppError } from "../common/errors.js"

export default fp(async (app) => {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).headers(err.headers).send({ detail: err.message })
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const detail = err.validation.map((v) => ({
        loc: [err.validationContext ?? "body", ...v.instancePath.split("/").filter(Boolean)],
        msg: v.message ?? "Invalid value",
      }))
      return reply.status(422).send({ detail })
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500
    if (status >= 500) {
      request.log.error({ err }, "unhandled error")
      return reply.status(500).send({ detail: "Internal server error" })
    }
    // Fastify's own 4xx errors (bad JSON, payload too large, rate limited…)
    return reply.status(status).send({ detail: (err as Error).message })
  })

  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ detail: "Not found" }))
})
