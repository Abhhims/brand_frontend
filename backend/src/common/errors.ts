/**
 * Errors the API returns on purpose. The response body is { "detail": "<message>" }, the same shape the
 * frontend already parses from the legacy API, so its error handling keeps working unchanged.
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public headers: Record<string, string> = {},
  ) {
    super(message)
    this.name = "AppError"
  }
}

export const notFound = (what = "Resource") => new AppError(404, `${what} not found`)
export const badRequest = (message: string) => new AppError(400, message)
export const conflict = (message: string) => new AppError(409, message)
export const unauthorized = () => new AppError(401, "Not authenticated", { "WWW-Authenticate": "Bearer" })
export const forbidden = (message = "Admin role required") => new AppError(403, message)
