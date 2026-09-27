import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { and, eq } from 'drizzle-orm'
import {
  biteViewEvents,
  exerciseBankItems,
  lessonVariants,
  retrievalPromptBankItems,
  skeletonNodes,
  topicRelations,
  topics,
  userNodeStates,
} from '../src/db/schema'
import { citationFor, splitSections } from '../src/learning/bites'
import { extractWikiLinks } from '../src/content/wikiLinks'
import { OfflineAiService } from '../src/ai/offline'
import { auth, createTestContext, type TestContext } from './helpers'

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

const getBite = (ctx: TestContext, id: string, uid = 'alice') => request(ctx.app).get(`/bites/${id}`).set(auth(uid))

describe('lesson content pipeline + bite composition', () => {
  let ctx: TestContext
  beforeEach(async () => {
    ctx = await createTestContext()
  })
  afterEach(async () => {
    await ctx.database.close()
  })

  it('generates a low-tier bite lazily without grounding and composes it', async () => {
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    const res = await getBite(ctx, firstBiteId)
    expect(res.status).toBe(200)
    const bite = res.body
    expect(ctx.ai.count('generateLesson')).toBe(1)
    expect(ctx.grounding.queries).toHaveLength(0)
    expect(bite).toMatchObject({ status: 'in_progress', scaffoldingTier: 'standard', contentSource: 'fake', teachingComplete: false })
    expect(bite.node).toMatchObject({ orderIndex: 0, nodeCount: 6, riskTier: 'low' })
    expect(bite.lesson.sections.length).toBeGreaterThanOrEqual(2)
    expect(bite.lesson.citation).toEqual({ kind: 'ungrounded', reason: 'low_risk' })
    expect(bite.prompts).toHaveLength(3)
    expect(bite.prompts.map((p: { afterSection: number }) => p.afterSection)).toEqual([0, 1, 2])
    expect(bite.prompts.every((p: { answered: unknown }) => p.answered === null)).toBe(true)
    expect(bite.exercise.testSpec).toContain('./solution')
    expect(bite.exercise.solutionCode).toBeNull()
    expect(bite.attempts).toEqual({ count: 0, passed: false, solutionRevealed: false, canRevealSolution: false })

    // The whole bank is stored (5 prompts, 2 validated exercises), not just what was shown.
    expect(await ctx.database.db.select().from(retrievalPromptBankItems)).toHaveLength(5)
    const exercises = await ctx.database.db.select().from(exerciseBankItems)
    expect(exercises).toHaveLength(2)
    expect(exercises.every((e) => e.componentType === 'code_exercise')).toBe(true)
  })

  it('serves repeat views and other learners from the shared cache', async () => {
    const alice = await enrollTopic(ctx, 'React')
    const bob = await enrollTopic(ctx, 'React', 'bob')
    const first = await getBite(ctx, alice.firstBiteId)
    const again = await getBite(ctx, alice.firstBiteId)
    const bobs = await getBite(ctx, bob.firstBiteId, 'bob')

    expect(ctx.ai.count('generateLesson')).toBe(1)
    expect(again.body.prompts.map((p: { id: string }) => p.id)).toEqual(first.body.prompts.map((p: { id: string }) => p.id))
    expect(bobs.body.lesson.id).toBe(first.body.lesson.id)
    const views = await ctx.database.db.select().from(biteViewEvents)
    expect(views.map((v) => v.cacheHit)).toEqual([false, true, true])
  })

  it('shares one generation between concurrent first views', async () => {
    const alice = await enrollTopic(ctx, 'React')
    const bob = await enrollTopic(ctx, 'React', 'bob')
    await Promise.all([getBite(ctx, alice.firstBiteId), getBite(ctx, bob.firstBiteId, 'bob')])
    expect(ctx.ai.count('generateLesson')).toBe(1)
    expect(await ctx.database.db.select().from(lessonVariants)).toHaveLength(1)
  })

  it('grounds medium-tier content and stores self-cited claims', async () => {
    const { userTopicProgressId } = await enrollTopic(ctx, 'React')
    const res = await getBite(ctx, await biteAt(ctx, userTopicProgressId, 3, true))
    expect(res.body.node.riskTier).toBe('medium')
    expect(ctx.grounding.queries).toHaveLength(1)
    expect(res.body.lesson.citation).toEqual({
      kind: 'grounded',
      sources: [
        { url: 'https://react.dev/reference/react/useEffect', title: 'useEffect – React', domain: 'react.dev' },
        { url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript', title: 'JavaScript | MDN', domain: 'developer.mozilla.org' },
      ],
    })
    const [variant] = await ctx.database.db.select().from(lessonVariants)
    expect(variant.groundingStatus).toBe('grounded')
    expect(variant.claims).toEqual([{ claim: expect.any(String), supportingSourceIndex: 0 }])
    expect((ctx.ai.calls.generateLesson[0] as { grounding: unknown[] }).grounding).toHaveLength(2)
  })

  it('fails closed when grounding is down, caching nothing', async () => {
    const { userTopicProgressId } = await enrollTopic(ctx, 'React')
    const bite = await biteAt(ctx, userTopicProgressId, 3, true)
    ctx.grounding.fail = true
    const failed = await getBite(ctx, bite)
    expect(failed.status).toBe(502)
    expect(failed.body.error.message).toMatch(/Try again/)
    expect(await ctx.database.db.select().from(lessonVariants)).toHaveLength(0)

    ctx.grounding.fail = false
    expect((await getBite(ctx, bite)).status).toBe(200)
  })

  it('marks medium content as not source-grounded when grounding is disabled (local dev)', async () => {
    ctx.grounding.enabled = false
    const { userTopicProgressId } = await enrollTopic(ctx, 'React')
    const res = await getBite(ctx, await biteAt(ctx, userTopicProgressId, 3, true))
    expect(res.body.lesson.citation).toEqual({ kind: 'ungrounded', reason: 'grounding_unavailable' })
  })

  it('verifies high-tier content and regenerates once with the concerns', async () => {
    const { userTopicProgressId } = await enrollTopic(ctx, 'JWT authentication')
    let checks = 0
    ctx.ai.overrides.verifyLesson = async () => (++checks === 1 ? { passed: false, concerns: ['Stores tokens in localStorage without caveat'] } : { passed: true, concerns: [] })
    const res = await getBite(ctx, await biteAt(ctx, userTopicProgressId, 4, true))
    expect(res.body.node.riskTier).toBe('high')
    expect(res.body.lesson.verification).toBe('passed')
    expect(ctx.ai.count('generateLesson')).toBe(2)
    expect((ctx.ai.calls.generateLesson[1] as { revisionNotes: string[] }).revisionNotes).toEqual(['Stores tokens in localStorage without caveat'])
    expect(ctx.ai.count('hedgeLesson')).toBe(0)
  })

  it('hedges high-tier content that fails verification twice', async () => {
    const { userTopicProgressId } = await enrollTopic(ctx, 'JWT authentication')
    ctx.ai.overrides.verifyLesson = async () => ({ passed: false, concerns: ['Claims HS256 is always sufficient'] })
    ctx.ai.overrides.hedgeLesson = async () => ({ explanationMarkdown: '## Signing\n\nThere are several approaches; consult the official docs.' })
    const res = await getBite(ctx, await biteAt(ctx, userTopicProgressId, 4, true))
    expect(res.body.lesson.verification).toBe('hedged')
    expect(res.body.lesson.sections).toEqual(['## Signing\n\nThere are several approaches; consult the official docs.'])
    const [variant] = await ctx.database.db.select().from(lessonVariants)
    expect(variant.verification).toEqual({ status: 'hedged', concerns: ['Claims HS256 is always sufficient'], attempts: 2 })
  })

  it('repairs exercises that fail validation and never stores untested ones', async () => {
    const offline = new OfflineAiService()
    ctx.ai.overrides.generateLesson = async (input) => {
      const draft = await offline.generateLesson(input)
      return { ...draft, exercises: [{ ...draft.exercises[0], solutionCode: draft.exercises[0].starterCode }, draft.exercises[1]] }
    }
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    const res = await getBite(ctx, firstBiteId)
    expect(res.status).toBe(200)
    expect(ctx.ai.count('repairExercises')).toBe(1)
    const failures = (ctx.ai.calls.repairExercises[0] as { failures: { problem: string }[] }).failures
    expect(failures).toHaveLength(1)
    expect(failures[0].problem).toMatch(/solution fails test/)
    expect(await ctx.database.db.select().from(exerciseBankItems)).toHaveLength(2)
  })

  it('serves the bite without an exercise when repair also fails', async () => {
    const offline = new OfflineAiService()
    ctx.ai.overrides.generateLesson = async (input) => {
      const draft = await offline.generateLesson(input)
      return { ...draft, exercises: [{ ...draft.exercises[0], testSpec: 'import fs from "node:fs"\nit("x", () => {})' }] }
    }
    ctx.ai.overrides.repairExercises = async (input) => input.failures.map((f) => f.exercise)
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    const res = await getBite(ctx, firstBiteId)
    expect(res.status).toBe(200)
    expect(res.body.exercise).toBeNull()
    expect(await ctx.database.db.select().from(exerciseBankItems)).toHaveLength(0)
  })

  it('regenerates suppressed content on the next view', async () => {
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    const first = await getBite(ctx, firstBiteId)
    await ctx.database.db.update(lessonVariants).set({ suppressedAt: new Date() }).where(eq(lessonVariants.id, first.body.lesson.id))
    const second = await getBite(ctx, firstBiteId)
    expect(second.body.lesson.id).not.toBe(first.body.lesson.id)
    const variants = await ctx.database.db.select().from(lessonVariants)
    expect(variants.find((v) => v.id === first.body.lesson.id)?.supersededAt).not.toBeNull()
    expect(variants.find((v) => v.id === second.body.lesson.id)?.version).toBe(2)
  })

  it('records wiki-links in lesson text as topic relations', async () => {
    const offline = new OfflineAiService()
    ctx.ai.overrides.generateLesson = async (input) => {
      const draft = await offline.generateLesson(input)
      return { ...draft, explanationMarkdown: `${draft.explanationMarkdown}\n\nPairs well with [[TypeScript]].` }
    }
    const { firstBiteId, topicId } = await enrollTopic(ctx, 'React')
    await getBite(ctx, firstBiteId)
    const [ts] = await ctx.database.db.select().from(topics).where(eq(topics.name, 'TypeScript'))
    const relations = await ctx.database.db.select().from(topicRelations).where(eq(topicRelations.toTopicId, ts.id))
    expect(relations).toEqual([expect.objectContaining({ fromTopicId: topicId, relationType: 'related' })])
  })

  it('blocks locked bites and hides other learners\' bites', async () => {
    const { userTopicProgressId, firstBiteId } = await enrollTopic(ctx, 'React')
    const locked = await getBite(ctx, await biteAt(ctx, userTopicProgressId, 2))
    expect(locked.status).toBe(409)
    expect(locked.body.error.code).toBe('bite_locked')
    expect((await getBite(ctx, firstBiteId, 'mallory')).status).toBe(404)
    expect(ctx.ai.count('generateLesson')).toBe(0)
  })
})

describe('bite helpers', () => {
  it('splits explanations into ## sections', () => {
    expect(splitSections('## A\ntext\n\n## B\nmore')).toEqual(['## A\ntext', '## B\nmore'])
    expect(splitSections('intro\n## A\nx')).toEqual(['intro', '## A\nx'])
  })

  it('never fabricates a citation for ungrounded content', () => {
    expect(citationFor({ groundingStatus: 'not_required', groundingSources: null })).toEqual({ kind: 'ungrounded', reason: 'low_risk' })
    expect(citationFor({ groundingStatus: 'grounded', groundingSources: [] })).toEqual({ kind: 'ungrounded', reason: 'low_risk' })
  })

  it('extracts unique wiki-links', () => {
    expect(extractWikiLinks('See [[TypeScript]] and [[typescript]] and [[Node.js|Node]].')).toEqual(['TypeScript', 'Node.js'])
  })
})
