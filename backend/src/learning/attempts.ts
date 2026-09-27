/**
 * Exercise attempts (Product-Spec flow 2 steps 4–6). Tests run client-side in Sandpack — learner
 * code never executes on the server — so the server records the reported result (instrumentation
 * floor: passed / hints / retries / time) and advances teaching completion on a pass.
 * "Hints used" = tutor questions asked in this bite before the attempt, plus 1 if the worked
 * solution was revealed (offered after FAILED_ATTEMPTS_BEFORE_REVEAL failed attempts).
 */
import { and, count, eq, lte } from 'drizzle-orm'
import type { AttemptRequest, AttemptResult, RevealSolutionResult } from '@shared/api'
import type { Db } from '../db/client'
import { biteAttempts, chatMessages, exerciseBankItems, userNodeStates, userTopicProgress } from '../db/schema'
import type { Clock } from '../lib/clock'
import { badRequest, conflict, HttpError } from '../lib/errors'
import { FAILED_ATTEMPTS_BEFORE_REVEAL, loadOwnedNodeState } from './bites'
import { refreshNodeProgress } from './mastery'
import { touchSession } from './sessions'

export interface AttemptDeps {
  db: Db
  clock: Clock
}

async function attemptStats(db: Db, stateId: string, exerciseId: string) {
  const rows = await db
    .select({ passed: biteAttempts.passed, n: count() })
    .from(biteAttempts)
    .where(and(eq(biteAttempts.userNodeStateId, stateId), eq(biteAttempts.exerciseBankItemId, exerciseId)))
    .groupBy(biteAttempts.passed)
  const failed = Number(rows.find((r) => !r.passed)?.n ?? 0)
  const passed = Number(rows.find((r) => r.passed)?.n ?? 0)
  return { failed, passed, total: failed + passed }
}

export async function recordAttempt(deps: AttemptDeps, userId: string, biteId: string, body: AttemptRequest): Promise<AttemptResult> {
  const { db, clock } = deps
  const { state } = await loadOwnedNodeState(db, userId, biteId)
  if (state.status === 'locked') throw new HttpError(409, 'bite_locked', 'This bite is still locked.')
  if (!state.selectedExerciseId) throw conflict('This bite has no exercise.', 'no_exercise')
  if (body.testsPassed > body.testsTotal) throw badRequest('testsPassed cannot exceed testsTotal.')
  if (body.passed && (body.testsTotal === 0 || body.testsPassed !== body.testsTotal)) {
    throw badRequest('A passing attempt must pass every test.')
  }
  const now = clock.now()
  const before = await attemptStats(db, state.id, state.selectedExerciseId)
  const [tutorQuestions] = await db
    .select({ n: count() })
    .from(chatMessages)
    .where(and(eq(chatMessages.userNodeStateId, state.id), eq(chatMessages.role, 'user'), lte(chatMessages.createdAt, now)))
  const sessionId = await touchSession(db, userId, now, 'new_content')

  await db.insert(biteAttempts).values({
    userNodeStateId: state.id,
    exerciseBankItemId: state.selectedExerciseId,
    userId,
    sessionId,
    submittedCode: body.code,
    passed: body.passed,
    testsPassed: body.testsPassed,
    testsTotal: body.testsTotal,
    hintsUsed: Number(tutorQuestions.n) + (state.solutionRevealedAt ? 1 : 0),
    attemptNumber: before.total + 1,
    timeTakenMs: body.timeTakenMs,
    createdAt: now,
  })
  await db.update(userTopicProgress).set({ lastActivityAt: now }).where(eq(userTopicProgress.id, state.userTopicProgressId))

  const progress = body.passed ? await refreshNodeProgress(db, state.id, now) : { teachingComplete: Boolean(state.teachingCompletedAt) }
  const everPassed = body.passed || before.passed > 0
  const failed = before.failed + (body.passed ? 0 : 1)
  return {
    attemptNumber: before.total + 1,
    passed: body.passed,
    canRevealSolution: !everPassed && !state.solutionRevealedAt && failed >= FAILED_ATTEMPTS_BEFORE_REVEAL,
    teachingComplete: progress.teachingComplete,
  }
}

export async function revealSolution(deps: AttemptDeps, userId: string, biteId: string): Promise<RevealSolutionResult> {
  const { db, clock } = deps
  const { state } = await loadOwnedNodeState(db, userId, biteId)
  if (!state.selectedExerciseId) throw conflict('This bite has no exercise.', 'no_exercise')
  const [exercise] = await db.select().from(exerciseBankItems).where(eq(exerciseBankItems.id, state.selectedExerciseId))
  if (!state.solutionRevealedAt) {
    const stats = await attemptStats(db, state.id, state.selectedExerciseId)
    if (stats.passed === 0 && stats.failed < FAILED_ATTEMPTS_BEFORE_REVEAL) {
      throw conflict(`Try the exercise ${FAILED_ATTEMPTS_BEFORE_REVEAL} times before revealing the solution.`, 'reveal_not_available')
    }
    await db.update(userNodeStates).set({ solutionRevealedAt: clock.now() }).where(eq(userNodeStates.id, state.id))
  }
  return { solutionCode: exercise.solutionCode }
}
