import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import type { ApiErrorBody } from '@shared/api'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found.`)
export const badRequest = (message: string, code = 'bad_request') => new HttpError(400, code, message)
export const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message)

/**
 * Thrown when an upstream AI / search call fails. The message is user-facing (UI-Kit error
 * convention: what happened + what to do), never the raw upstream error.
 */
export class UpstreamError extends HttpError {
  constructor(message: string, readonly causeDetail?: unknown) {
    super(502, 'upstream_unavailable', message)
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }
  let body: ApiErrorBody
  let status: number
  if (err instanceof HttpError) {
    status = err.status
    body = { error: { code: err.code, message: err.message } }
    if (err instanceof UpstreamError) console.error('[upstream]', err.causeDetail ?? err.message)
  } else if (err instanceof ZodError) {
    status = 400
    const detail = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
    body = { error: { code: 'validation_error', message: `Invalid request. ${detail}` } }
  } else if (err?.type === 'entity.too.large') {
    status = 413
    body = { error: { code: 'payload_too_large', message: 'That request is too large. Shorten it and try again.' } }
  } else if (err?.type === 'entity.parse.failed') {
    status = 400
    body = { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } }
  } else {
    console.error('[unhandled]', err)
    status = 500
    body = { error: { code: 'internal_error', message: 'Something went wrong on our side. Try again.' } }
  }
  res.status(status).json(body)
}
