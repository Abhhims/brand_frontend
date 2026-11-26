/** Structured JSON logs (one line per event) in production; readable output in development. */
import { pino, type LoggerOptions } from "pino"
import { env } from "../config/env.js"

export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: "brandintel" },
  redact: { paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"], censor: "[redacted]" },
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } } }
    : {}),
}

/** For code outside a request (workers, scripts). Inside routes use request.log so lines carry the request id. */
export const logger = pino(loggerOptions)
