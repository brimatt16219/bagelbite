import { notFound } from './errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Route params must be UUIDs; anything else is a 404 rather than a Postgres cast error. */
export function uuidParam(value: string | string[] | undefined, what: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw notFound(what)
  return value
}
