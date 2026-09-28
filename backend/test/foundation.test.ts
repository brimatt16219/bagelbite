import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { users } from '../src/db/schema'
import { loadConfig, ConfigError } from '../src/config'
import { FirebaseTokenVerifier, InvalidTokenError } from '../src/auth/verifier'
import { auth, createTestContext, type TestContext } from './helpers'

describe('backend foundation', () => {
  let ctx: TestContext
  beforeAll(async () => {
    ctx = await createTestContext()
  })
  afterAll(async () => {
    await ctx.database.close()
  })

  it('serves /health without auth', async () => {
    const res = await request(ctx.app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('rejects requests without a bearer token', async () => {
    const res = await request(ctx.app).get('/users/me')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('unauthenticated')
  })

  it('rejects malformed tokens', async () => {
    const res = await request(ctx.app).get('/users/me').set('Authorization', 'Bearer not-a-real-token')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('invalid_token')
  })

  it('upserts the user on first authenticated request', async () => {
    const res = await request(ctx.app).get('/users/me').set(auth('alice'))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 'dev-alice', email: 'alice@dev.local', subscriptionTier: 'free' })

    await request(ctx.app).get('/users/me').set(auth('alice')).expect(200)
    const rows = await ctx.database.db.select().from(users).where(eq(users.id, 'dev-alice'))
    expect(rows).toHaveLength(1)
  })

  it('returns JSON errors for unknown routes and bad JSON', async () => {
    const missing = await request(ctx.app).get('/nope').set(auth())
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('not_found')

    const badJson = await request(ctx.app)
      .post('/users/me')
      .set(auth())
      .set('Content-Type', 'application/json')
      .send('{not json')
    expect(badJson.status).toBe(400)
    expect(badJson.body.error.code).toBe('invalid_json')
  })
})

describe('config', () => {
  const base = { FIREBASE_PROJECT_ID: 'demo', TAVILY_API_KEY: 'tvly-x' }

  it('refuses dev conveniences in production', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        AUTH_MODE: 'dev',
        LLM_PROVIDER: 'offline',
        GROUNDING: 'off',
        DATABASE_URL: 'postgres://u:p@localhost:5432/db',
        ANTHROPIC_API_KEY: 'sk-ant-x',
      }),
    ).toThrow(/AUTH_MODE=dev.*LLM_PROVIDER=offline.*GROUNDING=off/)
  })

  it('requires a database and API key in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/DATABASE_URL.*ANTHROPIC_API_KEY/)
  })

  it('requires a Firebase project in firebase auth mode', () => {
    expect(() => loadConfig({ TAVILY_API_KEY: 'x' })).toThrow(ConfigError)
  })

  it('requires a real web origin for CORS in production', () => {
    const prod = { ...base, NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@h:5432/db', ANTHROPIC_API_KEY: 'k' }
    expect(() => loadConfig(prod)).toThrow(/CORS_ORIGINS must list/)
    expect(loadConfig({ ...prod, CORS_ORIGINS: 'https://bagelbite.app' }).corsOrigins).toEqual(['https://bagelbite.app'])
  })

  it('accepts a keyless local-dev setup', () => {
    const cfg = loadConfig({ AUTH_MODE: 'dev', LLM_PROVIDER: 'offline', GROUNDING: 'off', CORS_ORIGINS: 'http://a, http://b' })
    expect(cfg.corsOrigins).toEqual(['http://a', 'http://b'])
    expect(cfg.EXERCISE_VALIDATION).toBe(true)
  })
})

describe('FirebaseTokenVerifier', () => {
  it('maps a decoded token to an identity', async () => {
    const verifier = new FirebaseTokenVerifier(async () => ({ uid: 'u1', email: 'a@b.c', name: 'Ada', picture: 'https://x/p.png' }))
    expect(await verifier.verify('t')).toEqual({ uid: 'u1', email: 'a@b.c', displayName: 'Ada', photoUrl: 'https://x/p.png' })
  })

  it('treats auth/* failures as invalid tokens but surfaces infrastructure failures', async () => {
    const expired = new FirebaseTokenVerifier(async () => {
      throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
    })
    await expect(expired.verify('t')).rejects.toBeInstanceOf(InvalidTokenError)
    const outage = new FirebaseTokenVerifier(async () => {
      throw new Error('getaddrinfo ENOTFOUND www.googleapis.com')
    })
    await expect(outage.verify('t')).rejects.not.toBeInstanceOf(InvalidTokenError)
  })
})
