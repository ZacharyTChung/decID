/**
 * An error with an HTTP status and a stable machine-readable code. Kept in its own module so
 * that library code (chain access, trust policy, the verifier core) can throw it without
 * depending on the HTTP layer, its database-backed rate limiter or the app configuration.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
