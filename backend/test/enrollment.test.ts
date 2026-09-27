import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { curriculumSkeletons, skeletonNodes, topicRelations, topics, userNodeStates, userTopicProgress } from '../src/db/schema'
import { auth, createTestContext, type TestContext } from './helpers'

describe('enrollment + topic scoping', () => {
  let ctx: TestContext
  beforeEach(async () => {
    ctx = await createTestContext()
  })
  afterEach(async () => {
    await ctx.database.close()
  })

  const enroll = (topic: string, baseline = '', uid = 'alice') =>
    request(ctx.app).post('/topics/enroll').set(auth(uid)).send({ topic, baseline })

  it('generates a shared skeleton on the first-ever enrollment and drops the learner into bite 1', async () => {
    const res = await enroll('React', 'I know JavaScript')
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ status: 'resolved', topicName: 'React', alreadyEnrolled: false })
    expect(ctx.ai.count('scope')).toBe(1)

    const db = ctx.database.db
    const [skeleton] = await db.select().from(curriculumSkeletons)
    expect(skeleton).toMatchObject({ topicId: res.body.topicId, version: 1, visibility: 'canonical', authorUserId: null, contentSource: 'fake' })
    const nodes = await db.select().from(skeletonNodes).where(eq(skeletonNodes.curriculumSkeletonId, skeleton.id))
    expect(nodes).toHaveLength(6)
    const byOrder = new Map(nodes.map((n) => [n.orderIndex, n]))
    expect(byOrder.get(2)!.scaffoldsOn).toEqual([byOrder.get(0)!.id])

    // Related topics are captured as stub topics + relations (the graph screen is deferred).
    const relations = await db.select().from(topicRelations)
    expect(relations).toHaveLength(2)
    expect(relations.every((r) => r.fromTopicId === res.body.topicId)).toBe(true)

    const states = await db.select().from(userNodeStates)
    const statusByNode = new Map(states.map((s) => [s.skeletonNodeId, s.status]))
    expect(statusByNode.get(byOrder.get(0)!.id)).toBe('available')
    expect(statusByNode.get(byOrder.get(1)!.id)).toBe('available')
    expect(statusByNode.get(byOrder.get(2)!.id)).toBe('locked')
    const first = states.find((s) => s.id === res.body.firstBiteId)
    expect(first?.skeletonNodeId).toBe(byOrder.get(0)!.id)

    const [progress] = await db.select().from(userTopicProgress)
    expect(progress).toMatchObject({ selfReportedBaseline: 'I know JavaScript', curriculumSkeletonVersion: 1, prunedNodeIds: [] })
  })

  it('reuses the shared skeleton for later learners without calling Claude', async () => {
    const first = await enroll('React')
    const second = await enroll('react.js', 'Backend dev', 'bob')
    expect(second.status).toBe(201)
    expect(second.body.topicId).toBe(first.body.topicId)
    expect(ctx.ai.count('scope')).toBe(1)
    expect(await ctx.database.db.select().from(curriculumSkeletons)).toHaveLength(1)
    expect(await ctx.database.db.select().from(userTopicProgress)).toHaveLength(2)
  })

  it('is idempotent for a learner who is already enrolled', async () => {
    const first = await enroll('React')
    const again = await enroll('React')
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ alreadyEnrolled: true, userTopicProgressId: first.body.userTopicProgressId })
    expect(await ctx.database.db.select().from(userNodeStates)).toHaveLength(6)
  })

  it('returns disambiguation candidates for umbrella topics without writing anything', async () => {
    const res = await enroll('.NET')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('disambiguate')
    expect(res.body.candidates.length).toBeGreaterThanOrEqual(2)
    expect(await ctx.database.db.select().from(topics)).toHaveLength(0)
  })

  it('rejects out-of-vertical topics', async () => {
    const res = await enroll('Tax law basics')
    expect(res.body.status).toBe('unsupported')
    expect(res.body.message).toMatch(/programming/)
    expect(await ctx.database.db.select().from(topics)).toHaveLength(0)
  })

  it('dedups when the scoping call matches an existing topic', async () => {
    const react = await enroll('React')
    ctx.ai.overrides.scope = async (input) => {
      const match = input.similarTopics.find((t) => t.name === 'React')
      return { status: 'resolved', matchedExistingTopicId: match!.id, topicName: 'React', topicDescription: '', nodes: [], relatedTopics: [] }
    }
    const res = await enroll('React fundamentals', '', 'bob')
    expect(res.body.topicId).toBe(react.body.topicId)
    expect((ctx.ai.calls.scope[1] as { similarTopics: unknown[] }).similarTopics).toContainEqual({ id: react.body.topicId, name: 'React' })
    expect(await ctx.database.db.select().from(curriculumSkeletons)).toHaveLength(1)
  })

  it('promotes a stub related topic to a real one when someone enrolls in it', async () => {
    await enroll('React')
    const topicCount = (await ctx.database.db.select().from(topics)).length
    const res = await enroll('React testing')
    expect(res.body.status).toBe('resolved')
    expect(await ctx.database.db.select().from(topics)).toHaveLength(topicCount + 2) // stub reused; its own 2 new related stubs
    const [stub] = await ctx.database.db.select().from(topics).where(eq(topics.id, res.body.topicId))
    expect(stub.name).toBe('React testing')
  })

  it('creates exactly one skeleton when two learners enroll in a new topic at once', async () => {
    const [a, b] = await Promise.all([enroll('Rust ownership', '', 'alice'), enroll('Rust ownership', '', 'bob')])
    expect(a.body.topicId).toBe(b.body.topicId)
    expect(await ctx.database.db.select().from(curriculumSkeletons)).toHaveLength(1)
  })

  it('validates input', async () => {
    expect((await enroll('')).status).toBe(400)
    expect((await enroll('x'.repeat(121))).status).toBe(400)
    const res = await request(ctx.app).post('/topics/enroll').set(auth()).send({ baseline: 'no topic' })
    expect(res.body.error.code).toBe('validation_error')
  })

  it('lists enrollments with mastery-weighted progress and shows the curriculum', async () => {
    const enrolled = await enroll('React')
    const list = await request(ctx.app).get('/users/me/enrollments').set(auth())
    expect(list.body).toHaveLength(1)
    expect(list.body[0]).toMatchObject({ topicName: 'React', nodeCount: 6, masteredCount: 0, startedCount: 0, percentComplete: 0, dueReviewCount: 0 })

    const detail = await request(ctx.app).get(`/topics/${enrolled.body.topicId}/enrollment`).set(auth())
    expect(detail.status).toBe(200)
    expect(detail.body.nodes.map((n: { orderIndex: number }) => n.orderIndex)).toEqual([0, 1, 2, 3, 4, 5])
    expect(detail.body.nodes[2].prerequisiteTitles).toEqual([detail.body.nodes[0].title])
    expect(detail.body.relatedTopics).toHaveLength(2)
    expect(detail.body.baseline).toBe('')
  })

  it("never exposes another learner's enrollment", async () => {
    const enrolled = await enroll('React')
    expect((await request(ctx.app).get(`/topics/${enrolled.body.topicId}/enrollment`).set(auth('mallory'))).status).toBe(404)
    expect((await request(ctx.app).get('/topics/not-a-uuid/enrollment').set(auth())).status).toBe(404)
  })
})
