import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { biteAttempts, chatMessages, contentFlags, exerciseBankItems, lessonVariants, retrievalPromptBankItems } from '../src/db/schema'
import { chooseTier } from '../src/learning/adaptive'
import { confirmFlag, dismissFlag } from '../src/content/flags'
import { OfflineAiService } from '../src/ai/offline'
import { UpstreamError } from '../src/lib/errors'
import { auth, biteAt, createTestContext, enrollTopic, type TestContext } from './helpers'

describe('attempts, adaptive difficulty, flags and the chat tutor', () => {
  let ctx: TestContext
  beforeEach(async () => {
    ctx = await createTestContext()
  })
  afterEach(async () => {
    await ctx.database.close()
  })

  const getBite = (id: string, uid = 'alice') => request(ctx.app).get(`/bites/${id}`).set(auth(uid))
  const attempt = (id: string, passed: boolean, extra: Record<string, unknown> = {}) =>
    request(ctx.app)
      .post(`/bites/${id}/attempts`)
      .set(auth())
      .send({ code: 'export function f() {}', passed, testsPassed: passed ? 3 : 1, testsTotal: 3, timeTakenMs: 4200, ...extra })
  const flag = (id: string, body: object, uid = 'alice') => request(ctx.app).post(`/bites/${id}/flag`).set(auth(uid)).send(body)
  const chat = (id: string, message: string, extra: object = {}) =>
    request(ctx.app).post(`/bites/${id}/chat`).set(auth()).send({ message, ...extra })

  describe('exercise attempts', () => {
    it('numbers attempts and offers the worked solution after three failures', async () => {
      const { firstBiteId } = await enrollTopic(ctx, 'React')
      await getBite(firstBiteId)
      expect((await request(ctx.app).post(`/bites/${firstBiteId}/reveal-solution`).set(auth())).body.error.code).toBe('reveal_not_available')

      const results = []
      for (let i = 0; i < 3; i++) results.push((await attempt(firstBiteId, false)).body)
      expect(results.map((r) => r.attemptNumber)).toEqual([1, 2, 3])
      expect(results.map((r) => r.canRevealSolution)).toEqual([false, false, true])
      expect((await getBite(firstBiteId)).body.attempts).toMatchObject({ count: 3, canRevealSolution: true })

      const revealed = await request(ctx.app).post(`/bites/${firstBiteId}/reveal-solution`).set(auth())
      expect(revealed.body.solutionCode).toContain('export function')
      const bite = (await getBite(firstBiteId)).body
      expect(bite.exercise.solutionCode).toBe(revealed.body.solutionCode)
      expect(bite.attempts).toMatchObject({ solutionRevealed: true, canRevealSolution: false })

      await attempt(firstBiteId, true)
      const rows = await ctx.database.db.select().from(biteAttempts).where(eq(biteAttempts.attemptNumber, 4))
      expect(rows[0]).toMatchObject({ passed: true, hintsUsed: 1, timeTakenMs: 4200 })
    })

    it('counts tutor questions as hints and rejects inconsistent results', async () => {
      const { firstBiteId } = await enrollTopic(ctx, 'React')
      await getBite(firstBiteId)
      await chat(firstBiteId, 'Why does my test fail?')
      await attempt(firstBiteId, false)
      const [row] = await ctx.database.db.select().from(biteAttempts)
      expect(row.hintsUsed).toBe(1)
      expect((await attempt(firstBiteId, true, { testsPassed: 2 })).status).toBe(400)
      expect((await attempt(firstBiteId, false, { testsPassed: 9 })).status).toBe(400)
    })

    it('reports a missing exercise and a locked bite', async () => {
      const offline = new OfflineAiService()
      ctx.ai.overrides.generateLesson = async (input) => ({ ...(await offline.generateLesson(input)), exercises: [] })
      const { firstBiteId, userTopicProgressId } = await enrollTopic(ctx, 'React')
      await getBite(firstBiteId)
      expect((await attempt(firstBiteId, true)).body.error.code).toBe('no_exercise')
      expect((await attempt(await biteAt(ctx, userTopicProgressId, 2), true)).body.error.code).toBe('bite_locked')
    })
  })

  describe('adaptive difficulty', () => {
    it('moves a struggling learner to extra scaffolding on their next bite', async () => {
      const { firstBiteId, userTopicProgressId } = await enrollTopic(ctx, 'React')
      const first = (await getBite(firstBiteId)).body
      for (let i = 0; i < 4; i++) {
        await ctx.database.db.insert(biteAttempts).values({
          userNodeStateId: firstBiteId, exerciseBankItemId: first.exercise.id, userId: 'dev-alice', submittedCode: '', passed: false,
          testsPassed: 0, testsTotal: 3, hintsUsed: 0, attemptNumber: 1, timeTakenMs: 1, createdAt: new Date(ctx.clock.now().getTime() + i),
        })
      }
      const next = (await getBite(await biteAt(ctx, userTopicProgressId, 1))).body
      expect(next.scaffoldingTier).toBe('extra_scaffolding')
      expect((ctx.ai.calls.generateLesson.at(-1) as { tier: string }).tier).toBe('extra_scaffolding')
    })

    it('chooses tiers against the 80–85% band', () => {
      expect(chooseTier({ rate: null, samples: 2 }, 'extra_scaffolding')).toBe('extra_scaffolding')
      expect(chooseTier({ rate: 0.5, samples: 6 }, 'standard')).toBe('extra_scaffolding')
      expect(chooseTier({ rate: 0.95, samples: 6 }, 'extra_scaffolding')).toBe('standard')
      expect(chooseTier({ rate: 0.82, samples: 6 }, 'extra_scaffolding')).toBe('extra_scaffolding')
    })
  })

  describe('content flags', () => {
    it('logs low-risk flags without hiding the content', async () => {
      const { firstBiteId } = await enrollTopic(ctx, 'React')
      const bite = (await getBite(firstBiteId)).body
      const res = await flag(firstBiteId, { targetType: 'lesson_variant', targetId: bite.lesson.id, reason: 'Outdated API' })
      expect(res.status).toBe(201)
      const [row] = await ctx.database.db.select().from(contentFlags)
      expect(row).toMatchObject({ riskTierAtFlag: 'low', status: 'open', reason: 'Outdated API', userId: 'dev-alice' })
      expect((await getBite(firstBiteId)).body.lesson.id).toBe(bite.lesson.id)
      // A repeat flag from the same learner is idempotent.
      expect((await flag(firstBiteId, { targetType: 'lesson_variant', targetId: bite.lesson.id })).body.flagId).toBe(res.body.flagId)
    })

    it('suppresses high-risk content on a single flag and regenerates it for everyone', async () => {
      const { userTopicProgressId } = await enrollTopic(ctx, 'JWT authentication')
      const biteId = await biteAt(ctx, userTopicProgressId, 4, true)
      const bite = (await getBite(biteId)).body
      await flag(biteId, { targetType: 'lesson_variant', targetId: bite.lesson.id })
      const [variant] = await ctx.database.db.select().from(lessonVariants).where(eq(lessonVariants.id, bite.lesson.id))
      expect(variant.suppressedAt).not.toBeNull()
      const after = (await getBite(biteId)).body
      expect(after.lesson.id).not.toBe(bite.lesson.id)
      expect(ctx.ai.count('verifyLesson')).toBe(2) // the regenerated content is verified again
    })

    it('only accepts flags on content from the flagged bite', async () => {
      const { firstBiteId, userTopicProgressId } = await enrollTopic(ctx, 'React')
      await getBite(firstBiteId)
      const other = (await getBite(await biteAt(ctx, userTopicProgressId, 1))).body
      expect((await flag(firstBiteId, { targetType: 'retrieval_prompt', targetId: other.prompts[0].id })).status).toBe(404)
      expect((await flag(firstBiteId, { targetType: 'exercise', targetId: other.exercise.id }, 'mallory')).status).toBe(404)
      expect((await flag(firstBiteId, { targetType: 'exercise', targetId: 'nope' })).status).toBe(400)
    })

    it('confirming a flag retires a question; dismissing lifts a suppression', async () => {
      const { firstBiteId } = await enrollTopic(ctx, 'React')
      const bite = (await getBite(firstBiteId)).body
      const promptId = bite.prompts[0].id
      const res = await flag(firstBiteId, { targetType: 'retrieval_prompt', targetId: promptId })
      await confirmFlag(ctx.database.db, res.body.flagId, 'Answer key was wrong', ctx.clock.now())
      const [prompt] = await ctx.database.db.select().from(retrievalPromptBankItems).where(eq(retrievalPromptBankItems.id, promptId))
      expect(prompt.supersededAt).not.toBeNull()
      const refreshed = (await getBite(firstBiteId)).body
      expect(refreshed.prompts.map((p: { id: string }) => p.id)).not.toContain(promptId)
      expect(refreshed.prompts).toHaveLength(3)

      // Dismiss path: suppress an exercise (as a high-tier flag would), then dismiss.
      await ctx.database.db.update(exerciseBankItems).set({ suppressedAt: new Date() }).where(eq(exerciseBankItems.id, bite.exercise.id))
      const exerciseFlag = await flag(firstBiteId, { targetType: 'exercise', targetId: bite.exercise.id })
      await dismissFlag(ctx.database.db, exerciseFlag.body.flagId, null, ctx.clock.now())
      const [exercise] = await ctx.database.db.select().from(exerciseBankItems).where(eq(exerciseBankItems.id, bite.exercise.id))
      expect(exercise.suppressedAt).toBeNull()
      const flags = await ctx.database.db.select().from(contentFlags)
      expect(flags.map((f) => f.status).sort()).toEqual(['dismissed', 'reviewed'])
    })
  })

  describe('chat tutor', () => {
    it('streams the reply over SSE and persists both turns', async () => {
      const { firstBiteId } = await enrollTopic(ctx, 'React')
      await getBite(firstBiteId)
      const res = await chat(firstBiteId, 'What is a hook?', { code: 'export const x = 1', testOutput: '1 failing' })
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/event-stream/)
      const events = res.text.split('\n\n').filter(Boolean).map((line) => JSON.parse(line.replace(/^data: /, '')))
      expect(events.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toMatch(/Offline tutor/)
      expect(events.at(-1)).toMatchObject({ type: 'done', messageId: expect.any(String) })

      const input = ctx.ai.calls.streamTutor[0] as { code: string; testOutput: string; baseline: string }
      expect(input).toMatchObject({ code: 'export const x = 1', testOutput: '1 failing', baseline: '' })
      const history = await request(ctx.app).get(`/bites/${firstBiteId}/chat`).set(auth())
      expect(history.body.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
    })

    it('caps the history sent to the model', async () => {
      const { firstBiteId } = await enrollTopic(ctx, 'React')
      await getBite(firstBiteId)
      for (let i = 0; i < 10; i++) {
        await ctx.database.db.insert(chatMessages).values({
          userNodeStateId: firstBiteId, userId: 'dev-alice', role: i % 2 ? 'assistant' : 'user', content: `m${i}`, createdAt: new Date(ctx.clock.now().getTime() - 1000 + i),
        })
      }
      await chat(firstBiteId, 'latest question')
      const history = (ctx.ai.calls.streamTutor[0] as { history: { role: string; content: string }[] }).history
      expect(history.length).toBeLessThanOrEqual(8)
      expect(history[0].role).toBe('user')
      expect(history.at(-1)?.content).toBe('m9')
    })

    it('rejects invalid questions as JSON and reports stream failures as an event', async () => {
      const { firstBiteId, userTopicProgressId } = await enrollTopic(ctx, 'React')
      expect((await chat(firstBiteId, 'too early')).body.error.code).toBe('bite_not_started')
      await getBite(firstBiteId)
      expect((await chat(firstBiteId, '   ')).status).toBe(400)
      expect((await chat(await biteAt(ctx, userTopicProgressId, 2), 'locked?')).status).toBe(409)

      ctx.ai.overrides.streamTutor = async () => {
        throw new UpstreamError("The tutor couldn't respond right now. Try again.")
      }
      const res = await chat(firstBiteId, 'hello?')
      const events = res.text.split('\n\n').filter(Boolean).map((line) => JSON.parse(line.replace(/^data: /, '')))
      expect(events).toEqual([{ type: 'error', message: "The tutor couldn't respond right now. Try again." }])
    })
  })
})
