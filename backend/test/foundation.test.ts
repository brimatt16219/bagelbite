import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { users } from '../src/db/schema'
import { loadConfig, ConfigError } from '../src/config'
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

  it('accepts a keyless local-dev setup', () => {
    const cfg = loadConfig({ AUTH_MODE: 'dev', LLM_PROVIDER: 'offline', GROUNDING: 'off', CORS_ORIGINS: 'http://a, http://b' })
    expect(cfg.corsOrigins).toEqual(['http://a', 'http://b'])
    expect(cfg.EXERCISE_VALIDATION).toBe(true)
  })
})
