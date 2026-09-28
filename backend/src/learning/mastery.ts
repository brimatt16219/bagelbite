/**
 * Mastery-gated progression (Pedagogy #5, Architecture "Mastery gate").
 *
 * - Teaching complete: every question selected into the bite has a rated first-exposure answer,
 *   and the exercise (if the bite has one) has a passing attempt.
 * - Mastered: teaching is complete AND every taught question has correct answers rated good/easy
 *   in at least 2 distinct learning sessions. First exposure counts as the first session; FSRS
 *   (no same-day steps) guarantees the second comes on a later day.
 * - Mastering a node unlocks every node whose prerequisites (`scaffoldsOn`) are now all mastered.
 * - UserTopicProgress.percentComplete is mastery-weighted, and the enrollment completes when every
 *   node is mastered.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { biteAttempts, masteryEvents, reviewItems, reviewLogs, skeletonNodes, userNodeStates, userTopicProgress } from '../db/schema'
import { masteryPercent } from '../content/progress'

export const REQUIRED_SESSIONS = 2

export interface NodeProgress {
  teachingComplete: boolean
  nodeMastered: boolean
  unlockedBiteIds: string[]
}

export async function refreshNodeProgress(db: Db, stateId: string, now: Date): Promise<NodeProgress> {
  const [state] = await db.select().from(userNodeStates).where(eq(userNodeStates.id, stateId))
  if (!state) throw new Error(`UserNodeState ${stateId} not found`)
  const promptIds = state.selectedPromptIds
  const [progress] = await db.select({ userId: userTopicProgress.userId }).from(userTopicProgress).where(eq(userTopicProgress.id, state.userTopicProgressId))

  // Per-question evidence: is the first exposure rated, and how many distinct sessions had a
  // correct answer rated good/easy.
  const evidence = promptIds.length
    ? await db
        .select({
          promptId: reviewItems.retrievalPromptBankItemId,
          firstRated: sql<boolean>`bool_or(${reviewLogs.isFirstExposure} and ${reviewLogs.rating} is not null)`,
          strongSessions: sql<number>`count(distinct ${reviewLogs.sessionId}) filter (where ${reviewLogs.correct} and ${reviewLogs.rating} in ('good', 'easy'))::int`,
        })
        .from(reviewItems)
        .innerJoin(reviewLogs, eq(reviewLogs.reviewItemId, reviewItems.id))
        .where(and(eq(reviewItems.userId, progress.userId), inArray(reviewItems.retrievalPromptBankItemId, promptIds)))
        .groupBy(reviewItems.retrievalPromptBankItemId)
    : []
  const byPrompt = new Map(evidence.map((e) => [e.promptId, e]))

  let teachingCompletedAt = state.teachingCompletedAt
  if (!teachingCompletedAt && promptIds.length && promptIds.every((id) => byPrompt.get(id)?.firstRated)) {
    const exerciseDone = state.selectedExerciseId
      ? (
          await db
            .select({ id: biteAttempts.id })
            .from(biteAttempts)
            .where(and(eq(biteAttempts.userNodeStateId, state.id), eq(biteAttempts.exerciseBankItemId, state.selectedExerciseId), eq(biteAttempts.passed, true)))
            .limit(1)
        ).length > 0
      : true
    if (exerciseDone) {
      teachingCompletedAt = now
      await db.update(userNodeStates).set({ teachingCompletedAt: now }).where(eq(userNodeStates.id, state.id))
    }
  }

  const alreadyMastered = state.status === 'mastered'
  const sessions = promptIds.map((id) => byPrompt.get(id)?.strongSessions ?? 0)
  const nowMastered = !alreadyMastered && Boolean(teachingCompletedAt) && sessions.length > 0 && sessions.every((n) => n >= REQUIRED_SESSIONS)

  let unlockedBiteIds: string[] = []
  // Conditional transition: if two ratings land concurrently, only one records the mastery event.
  const [transitioned] = nowMastered
    ? await db
        .update(userNodeStates)
        .set({ status: 'mastered', completedAt: now })
        .where(and(eq(userNodeStates.id, state.id), ne(userNodeStates.status, 'mastered')))
        .returning({ id: userNodeStates.id })
    : []
  if (transitioned) {
    await db.insert(masteryEvents).values({
      userId: progress.userId,
      userNodeStateId: state.id,
      skeletonNodeId: state.skeletonNodeId,
      sessionsCount: Math.min(...sessions),
      createdAt: now,
    })
    unlockedBiteIds = await unlockDependents(db, state.userTopicProgressId)
    await refreshEnrollment(db, state.userTopicProgressId, now)
  }

  return { teachingComplete: Boolean(teachingCompletedAt), nodeMastered: alreadyMastered || nowMastered, unlockedBiteIds }
}

/** Unlocks locked nodes whose prerequisites are all mastered; returns the unlocked bite ids. */
async function unlockDependents(db: Db, progressId: string): Promise<string[]> {
  const rows = await db
    .select({ id: userNodeStates.id, nodeId: userNodeStates.skeletonNodeId, status: userNodeStates.status, scaffoldsOn: skeletonNodes.scaffoldsOn })
    .from(userNodeStates)
    .innerJoin(skeletonNodes, eq(skeletonNodes.id, userNodeStates.skeletonNodeId))
    .where(eq(userNodeStates.userTopicProgressId, progressId))
  const mastered = new Set(rows.filter((r) => r.status === 'mastered').map((r) => r.nodeId))
  const toUnlock = rows.filter((r) => r.status === 'locked' && r.scaffoldsOn.every((id) => mastered.has(id))).map((r) => r.id)
  if (toUnlock.length) await db.update(userNodeStates).set({ status: 'available' }).where(inArray(userNodeStates.id, toUnlock))
  return toUnlock
}

async function refreshEnrollment(db: Db, progressId: string, now: Date) {
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      mastered: sql<number>`count(*) filter (where ${userNodeStates.status} = 'mastered')::int`,
    })
    .from(userNodeStates)
    .where(eq(userNodeStates.userTopicProgressId, progressId))
  const complete = counts.total > 0 && counts.mastered === counts.total
  await db
    .update(userTopicProgress)
    .set({
      percentComplete: masteryPercent(counts.mastered, counts.total),
      ...(complete ? { status: 'completed' as const, completedAt: now } : {}),
      lastActivityAt: now,
    })
    .where(eq(userTopicProgress.id, progressId))
}

