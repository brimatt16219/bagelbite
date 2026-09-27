import express, { Router } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { eq } from 'drizzle-orm'
import type { UserDto } from '@shared/api'
import type { Config } from './config'
import type { Db } from './db/client'
import { users } from './db/schema'
import { authMiddleware, currentUser } from './auth/middleware'
import type { TokenVerifier } from './auth/verifier'
import { errorHandler, notFound } from './lib/errors'
import type { Clock } from './lib/clock'
import type { AiService } from './ai/types'
import { topicsRouter } from './routes/topics'

export interface AppDeps {
  config: Pick<Config, 'corsOrigins' | 'NODE_ENV'>
  db: Db
  verifier: TokenVerifier
  clock: Clock
  ai: AiService
}

export function createApp(deps: AppDeps) {
  const app = express()
  app.set('trust proxy', 1) // Railway terminates TLS in front of the app.
  app.use(helmet())
  app.use(
    cors({
      origin: deps.config.corsOrigins,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    }),
  )
  app.use(express.json({ limit: '100kb' }))

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  const api = Router()
  api.use(authMiddleware(deps))

  api.get('/users/me', async (req, res) => {
    const identity = currentUser(req)
    const [row] = await deps.db.select().from(users).where(eq(users.id, identity.uid))
    if (!row) throw notFound('User')
    const body: UserDto = {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      photoURL: row.photoUrl,
      subscriptionTier: row.subscriptionTier,
    }
    res.json(body)
  })

  api.use(topicsRouter(deps))

  app.use(api)
  app.use((_req, _res, next) => next(notFound('Route')))
  app.use(errorHandler)
  return app
}
