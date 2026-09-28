import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import type { PGlite } from '@electric-sql/pglite'
import { auth, createTestContext, enrollTopic, type TestContext } from './helpers'

const metricsSql = readFileSync(fileURLToPath(new URL('../scripts/metrics.sql', import.meta.url)), 'utf8')

describe('scripts/metrics.sql', () => {
  let ctx: TestContext
  beforeEach(async () => {
    ctx = await createTestContext()
  })
  afterEach(async () => {
    await ctx.database.close()
  })

  it('runs every query against a database with real learning activity', async () => {
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    const bite = (await request(ctx.app).get(`/bites/${firstBiteId}`).set(auth())).body
    const graded = await request(ctx.app)
      .post(`/bites/${firstBiteId}/retrieval-prompts/${bite.prompts[0].id}/response`)
      .set(auth())
      .send({ response: 'The main idea is to explain and apply the key ideas', confidence: 3 })
    await request(ctx.app).post(`/review-logs/${graded.body.logId}/rating`).set(auth()).send({ rating: 'good' })
    await request(ctx.app)
      .post(`/bites/${firstBiteId}/attempts`)
      .set(auth())
      .send({ code: 'x', passed: false, testsPassed: 0, testsTotal: 3, timeTakenMs: 10 })

    const client = (ctx.database.db as unknown as { $client: PGlite }).$client
    const results = await client.exec(metricsSql)
    expect(results.length).toBeGreaterThanOrEqual(12)

    const calibration = results.find((r) => r.fields.some((f) => f.name === 'confidence_rating'))
    expect(calibration?.rows).toEqual([expect.objectContaining({ confidence_rating: 3, answers: 1 })])
    const cache = results.find((r) => r.fields.some((f) => f.name === 'cache_hit_pct'))
    expect(cache?.rows[0]).toMatchObject({ bite_views: 1 })
  })
})
