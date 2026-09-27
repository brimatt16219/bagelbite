import request from 'supertest'
import { expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { skeletonNodes, userNodeStates } from '../src/db/schema'
import { openPglite, type Database } from '../src/db/client'
import { createApp, type AppDeps } from '../src/app'
import { DevTokenVerifier } from '../src/auth/verifier'
import { FakeClock } from '../src/lib/clock'
import { FakeAiService } from './fakeAi'
import { FakeGrounding } from './fakeGrounding'
import { SandboxExerciseValidator } from '../src/content/exerciseValidator'

export interface TestContext {
  database: Database
  clock: FakeClock
  ai: FakeAiService
  grounding: FakeGrounding
  app: ReturnType<typeof createApp>
  deps: AppDeps
}

/** Fresh in-memory Postgres (PGlite) with migrations applied, plus an app wired to it. */
export async function createTestContext(overrides: Partial<AppDeps> = {}): Promise<TestContext> {
  const database = await openPglite()
  const clock = new FakeClock()
  const ai = new FakeAiService()
  const grounding = new FakeGrounding()
  const deps: AppDeps = {
    config: { corsOrigins: ['http://localhost:5173'], NODE_ENV: 'test' },
    db: database.db,
    verifier: new DevTokenVerifier(),
    clock,
    ai,
    grounding,
    validator: new SandboxExerciseValidator(),
    ...overrides,
  }
  return { database, clock, ai, grounding, app: createApp(deps), deps }
}

export const auth = (uid = 'alice') => ({ Authorization: `Bearer dev:${uid}` })

export async function enrollTopic(ctx: TestContext, topic: string, uid = 'alice') {
  const res = await request(ctx.app).post('/topics/enroll').set(auth(uid)).send({ topic })
  expect(res.body.status).toBe('resolved')
  return res.body as { topicId: string; userTopicProgressId: string; firstBiteId: string }
}

/** UserNodeState id for the node at `orderIndex`, optionally force-unlocked for the test. */
export async function biteAt(ctx: TestContext, progressId: string, orderIndex: number, unlock = false) {
  const [row] = await ctx.database.db
    .select({ id: userNodeStates.id })
    .from(userNodeStates)
    .innerJoin(skeletonNodes, eq(skeletonNodes.id, userNodeStates.skeletonNodeId))
    .where(and(eq(userNodeStates.userTopicProgressId, progressId), eq(skeletonNodes.orderIndex, orderIndex)))
  if (unlock) await ctx.database.db.update(userNodeStates).set({ status: 'available' }).where(eq(userNodeStates.id, row.id))
  return row.id
}
