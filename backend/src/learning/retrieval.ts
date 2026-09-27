/**
 * Retrieval practice (Pedagogy #1, #9, #10, #14; Product-Spec flows 2–3). Two steps:
 *   1. respond — the learner's free-recall answer + pre-reveal confidence (1–4) is graded by Haiku
 *      against the shared answer key. A wrong answer that matches an anticipated misconception gets
 *      the pre-authored correction; otherwise the grading call's own targeted feedback is used.
 *      Logged as a ReviewLog with rating = null.
 *   2. rate — after the reveal the learner self-rates Again/Hard/Good/Easy; ts-fsrs schedules the
 *      next review, then node progress (teaching completion, mastery, unlocks) is refreshed.
 * The same flow serves first exposure (inside a bite) and later spaced reviews.
 */
import { and, eq, gte, ne } from 'drizzle-orm'
import type { ConfidenceRating, RatingResult, RetrievalResponseResult, ReviewRating } from '@shared/api'
import type { Db } from '../db/client'
import { retrievalPromptBankItems, reviewItems, reviewLogs, userTopicProgress } from '../db/schema'
import type { AiService } from '../ai/types'
import type { Clock } from '../lib/clock'
import { badRequest, conflict, notFound } from '../lib/errors'
import { loadOwnedNodeState } from './bites'
import { newCard, schedule, suggestedRating } from './fsrs'
import { refreshNodeProgress } from './mastery'
import { touchSession } from './sessions'

export interface RetrievalDeps {
  db: Db
  ai: AiService
  clock: Clock
}

export async function respondToPrompt(
  deps: RetrievalDeps,
  userId: string,
  biteId: string,
  promptId: string,
  response: string,
  confidence: ConfidenceRating,
): Promise<RetrievalResponseResult> {
  const { db, clock } = deps
  const owned = await loadOwnedNodeState(db, userId, biteId)
  const [prompt] = await db.select().from(retrievalPromptBankItems).where(eq(retrievalPromptBankItems.id, promptId))
  if (!prompt || prompt.skeletonNodeId !== owned.state.skeletonNodeId) throw notFound('Question')
  const now = clock.now()

  const [item] = await db
    .select()
    .from(reviewItems)
    .where(and(eq(reviewItems.userId, userId), eq(reviewItems.retrievalPromptBankItemId, promptId)))

  let reviewItemId: string
  let isFirstExposure: boolean
  if (!item) {
    // First exposure: only for questions actually selected into this learner's bite.
    if (!owned.state.selectedPromptIds.includes(promptId)) throw notFound('Question')
    const card = newCard(now)
    const [created] = await db
      .insert(reviewItems)
      .values({ retrievalPromptBankItemId: promptId, userId, userNodeStateId: owned.state.id, fsrs: card, due: new Date(card.due), createdAt: now })
      .onConflictDoNothing({ target: [reviewItems.userId, reviewItems.retrievalPromptBankItemId] })
      .returning({ id: reviewItems.id })
    if (!created) throw conflict('You already answered this question.', 'already_answered')
    reviewItemId = created.id
    isFirstExposure = true
  } else {
    // A spaced review: only once FSRS has scheduled the item and it has come due.
    if (!item.lastRatedAt) {
      const [pending] = await db
        .select({ id: reviewLogs.id })
        .from(reviewLogs)
        .where(and(eq(reviewLogs.reviewItemId, item.id), eq(reviewLogs.isFirstExposure, true)))
      if (pending) throw conflict('Rate your recall on this question before answering it again.', 'rating_pending')
    } else if (item.due > now) {
      throw conflict("This question isn't due for review yet.", 'not_due')
    }
    reviewItemId = item.id
    isFirstExposure = false
  }

  const grade = await deps.ai.grade(
    {
      prompt: prompt.prompt,
      kind: prompt.kind,
      answerKey: prompt.answerKey,
      misconceptions: prompt.anticipatedMisconceptions,
      response,
    },
    { userId },
  )
  const misconception = grade.matchedMisconceptionIndex !== null ? prompt.anticipatedMisconceptions[grade.matchedMisconceptionIndex] : undefined
  const fromBank = !grade.correct && misconception !== undefined
  const feedback = fromBank ? misconception.correction : grade.feedback

  const sessionId = await touchSession(db, userId, now, isFirstExposure ? 'new_content' : 'review')
  const [log] = await db
    .insert(reviewLogs)
    .values({
      reviewItemId,
      userId,
      sessionId,
      userResponse: response,
      correct: grade.correct,
      feedback,
      gradingSource: fromBank ? 'misconception_bank' : 'live',
      matchedMisconceptionIndex: fromBank ? grade.matchedMisconceptionIndex : null,
      confidenceRating: confidence,
      isFirstExposure,
      createdAt: now,
    })
    .returning({ id: reviewLogs.id })
  await db.update(userTopicProgress).set({ lastActivityAt: now }).where(eq(userTopicProgress.id, owned.state.userTopicProgressId))

  return {
    logId: log.id,
    correct: grade.correct,
    feedback,
    answerKey: prompt.answerKey,
    gradingSource: fromBank ? 'misconception_bank' : 'live',
    suggestedRating: suggestedRating(grade.correct, confidence),
  }
}

export async function rateReviewLog(deps: RetrievalDeps, userId: string, logId: string, rating: ReviewRating): Promise<RatingResult> {
  const { db, clock } = deps
  const [row] = await db
    .select({ log: reviewLogs, item: reviewItems })
    .from(reviewLogs)
    .innerJoin(reviewItems, eq(reviewItems.id, reviewLogs.reviewItemId))
    .where(and(eq(reviewLogs.id, logId), eq(reviewLogs.userId, userId)))
  if (!row) throw notFound('Answer')
  if (row.log.rating) throw conflict('You already rated this answer.', 'already_rated')
  if (!row.log.correct && rating !== 'again') throw badRequest('A wrong answer is always rated "again".', 'invalid_rating')
  // Only the latest answer on an item may be rated — an abandoned, superseded answer must not
  // apply FSRS a second time.
  const [newer] = await db
    .select({ id: reviewLogs.id })
    .from(reviewLogs)
    .where(and(eq(reviewLogs.reviewItemId, row.item.id), ne(reviewLogs.id, logId), gte(reviewLogs.createdAt, row.log.createdAt)))
    .limit(1)
  if (newer) throw conflict('This answer was replaced by a later one.', 'stale_answer')

  const now = clock.now()
  const card = schedule(row.item.fsrs, now, rating)
  await db.transaction(async (tx) => {
    await tx.update(reviewLogs).set({ rating, ratedAt: now }).where(eq(reviewLogs.id, logId))
    await tx.update(reviewItems).set({ fsrs: card, due: new Date(card.due), lastRatedAt: now }).where(eq(reviewItems.id, row.item.id))
  })
  const progress = await refreshNodeProgress(db, row.item.userNodeStateId, now)
  return { nextDueAt: card.due, ...progress }
}
