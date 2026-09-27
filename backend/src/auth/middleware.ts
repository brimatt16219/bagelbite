import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { users } from '../db/schema'
import { HttpError } from '../lib/errors'
import type { Clock } from '../lib/clock'
import { InvalidTokenError, type AuthIdentity, type TokenVerifier } from './verifier'

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthIdentity
  }
}

const UPSERT_TTL_MS = 5 * 60 * 1000

/**
 * Bearer-token auth (`Authorization: Bearer <Firebase ID token>`), then upserts the user row.
 * The upsert is skipped for 5 minutes after the last one to avoid a write on every request.
 */
export function authMiddleware(deps: { db: Db; verifier: TokenVerifier; clock: Clock }): RequestHandler {
  const recentlyUpserted = new Map<string, number>()

  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? ''
    const [scheme, token] = header.split(' ')
    if (scheme !== 'Bearer' || !token) {
      throw new HttpError(401, 'unauthenticated', 'Sign in to continue.')
    }
    let identity: AuthIdentity
    try {
      identity = await deps.verifier.verify(token)
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        throw new HttpError(401, 'invalid_token', 'Your session has expired. Sign in again.')
      }
      throw err
    }

    const nowMs = deps.clock.now().getTime()
    const last = recentlyUpserted.get(identity.uid)
    if (last === undefined || nowMs - last > UPSERT_TTL_MS) {
      await deps.db
        .insert(users)
        .values({
          id: identity.uid,
          email: identity.email,
          displayName: identity.displayName,
          photoUrl: identity.photoUrl,
          lastSeenAt: new Date(nowMs),
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: identity.email,
            displayName: sql`coalesce(nullif(${identity.displayName}, ''), ${users.displayName})`,
            photoUrl: sql`coalesce(nullif(${identity.photoUrl}, ''), ${users.photoUrl})`,
            lastSeenAt: new Date(nowMs),
          },
        })
      recentlyUpserted.set(identity.uid, nowMs)
    }

    req.user = identity
    next()
  }
}

export function currentUser(req: Request): AuthIdentity {
  if (!req.user) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.')
  return req.user
}
