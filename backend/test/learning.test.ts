import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { biteAttempts, masteryEvents, reviewLogs, userNodeStates, userTopicProgress } from '../src/db/schema'
import { fromStored, newCard, schedule, suggestedRating, toStored } from '../src/learning/fsrs'
import { auth, biteAt, createTestContext, enrollTopic, type TestContext } from './helpers'

interface Prompt {
  id: string
}

describe('retrieval, FSRS scheduling, mastery gate and session composer', () => {
  let ctx: TestContext
  beforeEach(async () => {
    ctx = await createTestContext()
  })
  afterEach(async () => {
    await ctx.database.close()
  })

  const getBite = (id: string, uid = 'alice') => request(ctx.app).get(`/bites/${id}`).set(auth(uid))
  const respond = (biteId: string, promptId: string, response: string, confidence = 3, uid = 'alice') =>
    request(ctx.app).post(`/bites/${biteId}/retrieval-prompts/${promptId}/response`).set(auth(uid)).send({ response, confidence })
  const rate = (logId: string, rating: string, uid = 'alice') => request(ctx.app).post(`/review-logs/${logId}/rating`).set(auth(uid)).send({ rating })

  /** Works through a whole bite: answer + rate every question correctly, and pass the exercise. */
  async function completeTeaching(biteId: string) {
    const bite = (await getBite(biteId)).body
    await ctx.database.db.insert(biteAttempts).values({
      userNodeStateId: biteId, exerciseBankItemId: bite.exercise.id, userId: 'dev-alice', submittedCode: '//', passed: true,
      testsPassed: 3, testsTotal: 3, hintsUsed: 0, attemptNumber: 1, timeTakenMs: 1000, createdAt: ctx.clock.now(),
    })
    let last
    for (const p of bite.prompts as Prompt[]) {
      const graded = await respond(biteId, p.id, 'The main idea is to explain and apply the key ideas of this bite in practice', 3)
      expect(graded.body.correct).toBe(true)
      last = await rate(graded.body.logId, 'good')
      expect(last.status).toBe(200)
    }
    return last!.body
  }

  it('grades a correct first-exposure answer and schedules it only after the self-rating', async () => {
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    const [prompt] = (await getBite(firstBiteId)).body.prompts as Prompt[]
    const graded = await respond(firstBiteId, prompt.id, 'The main idea is to explain and apply the key ideas here', 4)
    expect(graded.status).toBe(201)
    expect(graded.body).toMatchObject({ correct: true, gradingSource: 'live', suggestedRating: 'easy' })
    expect(graded.body.answerKey).toMatch(/main idea/)

    // Answered but not yet rated: not a due review, and it shows as pending in the bite.
    const due = await request(ctx.app).get('/users/me/reviews/due').set(auth())
    expect(due.body.reviews).toHaveLength(0)
    const bite = await getBite(firstBiteId)
    expect(bite.body.prompts[0].answered).toMatchObject({ correct: true, rating: null, confidence: 4 })

    const rated = await rate(graded.body.logId, 'good')
    expect(rated.status).toBe(200)
    expect(new Date(rated.body.nextDueAt).getTime() - ctx.clock.now().getTime()).toBe(3 * 24 * 3600 * 1000)
    const [log] = await ctx.database.db.select().from(reviewLogs)
    expect(log).toMatchObject({ confidenceRating: 4, isFirstExposure: true, rating: 'good' })
  })

  it('serves the pre-authored correction when a wrong answer matches an anticipated misconception', async () => {
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    const [prompt] = (await getBite(firstBiteId)).body.prompts as Prompt[]
    const graded = await respond(firstBiteId, prompt.id, "I don't know", 1)
    expect(graded.body).toMatchObject({ correct: false, gradingSource: 'misconception_bank', suggestedRating: 'again' })
    expect(graded.body.feedback).toMatch(/Have a go from memory/)

    const invalid = await rate(graded.body.logId, 'good')
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe('invalid_rating')
    expect((await rate(graded.body.logId, 'again')).status).toBe(200)
  })

  it('uses the live grader feedback when no misconception matches', async () => {
    ctx.ai.overrides.grade = async () => ({ correct: false, matchedMisconceptionIndex: null, feedback: 'You described props, not state.' })
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    const [prompt] = (await getBite(firstBiteId)).body.prompts as Prompt[]
    const graded = await respond(firstBiteId, prompt.id, 'props are passed in')
    expect(graded.body).toMatchObject({ feedback: 'You described props, not state.', gradingSource: 'live' })
  })

  it('guards the answer/rate cycle', async () => {
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    const [prompt] = (await getBite(firstBiteId)).body.prompts as Prompt[]
    const graded = await respond(firstBiteId, prompt.id, 'The main idea is to explain and apply the key ideas')
    expect((await respond(firstBiteId, prompt.id, 'again?')).body.error.code).toBe('rating_pending')
    await rate(graded.body.logId, 'good')
    expect((await rate(graded.body.logId, 'easy')).body.error.code).toBe('already_rated')
    expect((await respond(firstBiteId, prompt.id, 'again?')).body.error.code).toBe('not_due')
    expect((await rate(graded.body.logId, 'good', 'mallory')).status).toBe(404)
  })

  it('validates responses and ownership', async () => {
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    const bite = (await getBite(firstBiteId)).body
    const promptId = bite.prompts[0].id
    expect((await respond(firstBiteId, promptId, 'x', 5)).status).toBe(400)
    expect((await respond(firstBiteId, promptId, '   ')).status).toBe(400)
    expect((await respond(firstBiteId, promptId, 'answer', 3, 'mallory')).status).toBe(404)
    expect((await respond(firstBiteId, '00000000-0000-4000-8000-000000000000', 'answer')).status).toBe(404)
  })

  it('completes teaching only when every question is rated and the exercise has passed', async () => {
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    const result = await completeTeaching(firstBiteId)
    expect(result).toMatchObject({ teachingComplete: true, nodeMastered: false, unlockedBiteIds: [] })
    expect((await getBite(firstBiteId)).body.teachingComplete).toBe(true)
  })

  it('masters a node only after a second, spaced session, then unlocks its dependents', async () => {
    const { firstBiteId, userTopicProgressId, topicId } = await enrollTopic(ctx, 'React')
    const dependent = await biteAt(ctx, userTopicProgressId, 2) // scaffoldsOn node 0
    await completeTeaching(firstBiteId)

    // Same sitting: nothing is due yet, so mastery can't be reached by re-answering.
    expect((await request(ctx.app).get(`/users/me/reviews/due`).set(auth())).body.reviews).toHaveLength(0)

    ctx.clock.advanceDays(4)
    const due = (await request(ctx.app).get('/users/me/reviews/due').set(auth())).body.reviews
    expect(due).toHaveLength(3)
    expect(due[0]).toMatchObject({ biteId: firstBiteId, topicId, topicName: 'React' })
    expect((await request(ctx.app).get(`/topics/${topicId}/next`).set(auth())).body).toEqual({ type: 'reviews', dueCount: 3 })

    let result
    for (const item of due) {
      const graded = await respond(item.biteId, item.promptId, 'The main idea is to explain and apply the key ideas of this bite', 3)
      expect(graded.status).toBe(201)
      result = (await rate(graded.body.logId, 'good')).body
    }
    expect(result).toMatchObject({ nodeMastered: true, unlockedBiteIds: [dependent] })

    const [state] = await ctx.database.db.select().from(userNodeStates).where(eq(userNodeStates.id, firstBiteId))
    expect(state.status).toBe('mastered')
    const [dependentState] = await ctx.database.db.select().from(userNodeStates).where(eq(userNodeStates.id, dependent))
    expect(dependentState.status).toBe('available')
    const events = await ctx.database.db.select().from(masteryEvents)
    expect(events).toEqual([expect.objectContaining({ userNodeStateId: firstBiteId, sessionsCount: 2 })])
    const [progress] = await ctx.database.db.select().from(userTopicProgress).where(eq(userTopicProgress.id, userTopicProgressId))
    expect(progress.percentComplete).toBe(17)

    const reviewLogsForItem = await ctx.database.db.select().from(reviewLogs).where(eq(reviewLogs.isFirstExposure, false))
    expect(reviewLogsForItem).toHaveLength(3)
  })

  it('does not count a "hard" or wrong review toward mastery', async () => {
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    await completeTeaching(firstBiteId)
    ctx.clock.advanceDays(4)
    const due = (await request(ctx.app).get('/users/me/reviews/due').set(auth())).body.reviews
    let result
    for (const item of due) {
      const graded = await respond(item.biteId, item.promptId, 'The main idea is to explain and apply the key ideas of this bite', 2)
      result = (await rate(graded.body.logId, 'hard')).body
    }
    expect(result.nodeMastered).toBe(false)
  })

  it('refuses to rate an answer superseded by a later one', async () => {
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    await completeTeaching(firstBiteId)
    ctx.clock.advanceDays(4)
    const [item] = (await request(ctx.app).get('/users/me/reviews/due').set(auth())).body.reviews
    const abandoned = await respond(item.biteId, item.promptId, 'first try', 2)
    ctx.clock.advance(60_000)
    const retried = await respond(item.biteId, item.promptId, 'The main idea is to explain and apply the key ideas', 3)
    expect((await rate(abandoned.body.logId, 'again')).body.error.code).toBe('stale_answer')
    expect((await rate(retried.body.logId, 'good')).status).toBe(200)
  })

  it('composes the next step: current bite, then next unlocked bite, then waiting for reviews', async () => {
    const { firstBiteId, userTopicProgressId, topicId } = await enrollTopic(ctx, 'React')
    const next = () => request(ctx.app).get(`/topics/${topicId}/next`).set(auth()).then((r) => r.body)
    expect(await next()).toMatchObject({ type: 'bite', biteId: firstBiteId })

    await completeTeaching(firstBiteId)
    const second = await biteAt(ctx, userTopicProgressId, 1)
    expect(await next()).toMatchObject({ type: 'bite', biteId: second })

    await completeTeaching(second)
    const waiting = await next()
    expect(waiting.type).toBe('waiting')
    expect(new Date(waiting.nextReviewAt).getTime()).toBe(ctx.clock.now().getTime() + 3 * 24 * 3600 * 1000)

    ctx.clock.advanceDays(3)
    expect((await next()).type).toBe('reviews')
    expect((await request(ctx.app).get(`/topics/${topicId}/next`).set(auth('mallory'))).status).toBe(404)
  })

  it('reports the dashboard with due-review counts', async () => {
    const { firstBiteId } = await enrollTopic(ctx, 'React')
    await completeTeaching(firstBiteId)
    ctx.clock.advanceDays(4)
    const dashboard = await request(ctx.app).get('/users/me/dashboard').set(auth())
    expect(dashboard.body).toMatchObject({ dueReviewCount: 3, masteredTotal: 0, nodeTotal: 6 })
    expect(dashboard.body.enrollments[0]).toMatchObject({ dueReviewCount: 3, startedCount: 1 })
  })

})

describe('fsrs helpers', () => {
  it('maps correctness and confidence to a suggested rating', () => {
    expect(suggestedRating(false, 4)).toBe('again')
    expect(suggestedRating(true, 1)).toBe('hard')
    expect(suggestedRating(true, 3)).toBe('good')
    expect(suggestedRating(true, 4)).toBe('easy')
  })

  it('round-trips cards through jsonb-safe storage and moves due dates forward', () => {
    const now = new Date('2026-09-01T09:00:00Z')
    const card = newCard(now)
    expect(toStored(fromStored(card))).toEqual(card)
    const good = schedule(card, now, 'good')
    const easy = schedule(card, now, 'easy')
    expect(new Date(easy.due).getTime()).toBeGreaterThan(new Date(good.due).getTime())
    expect(schedule(good, new Date(good.due), 'good').reps).toBe(2)
  })
})
