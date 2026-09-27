/**
 * Deterministic adaptive-difficulty signal (Pedagogy #4, Content-Sharing §3) — no LLM call.
 * The rolling first-attempt success rate over the learner's most recent events in this enrollment
 * (first exercise attempt passed / first-exposure retrieval answered correctly) picks the
 * scaffolding tier of the next node they open, loosely targeting an 80–85% success band.
 * Deliberately not precision-tuned (MVP-Synthesis): log it, eyeball it, tune with real data later.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import type { ScaffoldingTier } from '@shared/api'
import type { Db } from '../db/client'
import { biteAttempts, reviewItems, reviewLogs, userNodeStates } from '../db/schema'

export const SIGNAL_WINDOW = 12
export const MIN_SAMPLES = 4
export const LOWER_BAND = 0.8
export const UPPER_BAND = 0.85

export interface SuccessSignal {
  rate: number | null
  samples: number
}

export async function successSignal(db: Db, progressId: string): Promise<SuccessSignal> {
  const attempts = await db
    .select({ success: biteAttempts.passed, at: biteAttempts.createdAt })
    .from(biteAttempts)
    .innerJoin(userNodeStates, eq(userNodeStates.id, biteAttempts.userNodeStateId))
    .where(and(eq(userNodeStates.userTopicProgressId, progressId), eq(biteAttempts.attemptNumber, 1)))
    .orderBy(desc(biteAttempts.createdAt))
    .limit(SIGNAL_WINDOW)
  const firstExposures = await db
    .select({ success: reviewLogs.correct, at: reviewLogs.createdAt })
    .from(reviewLogs)
    .innerJoin(reviewItems, eq(reviewItems.id, reviewLogs.reviewItemId))
    .innerJoin(userNodeStates, eq(userNodeStates.id, reviewItems.userNodeStateId))
    .where(and(eq(userNodeStates.userTopicProgressId, progressId), eq(reviewLogs.isFirstExposure, true)))
    .orderBy(desc(reviewLogs.createdAt))
    .limit(SIGNAL_WINDOW)

  const recent = [...attempts, ...firstExposures].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, SIGNAL_WINDOW)
  if (recent.length < MIN_SAMPLES) return { rate: null, samples: recent.length }
  return { rate: recent.filter((e) => e.success).length / recent.length, samples: recent.length }
}

export function chooseTier(signal: SuccessSignal, currentTier: ScaffoldingTier): ScaffoldingTier {
  if (signal.rate === null) return currentTier
  if (signal.rate < LOWER_BAND) return 'extra_scaffolding' // struggling: ease off
  if (signal.rate > UPPER_BAND) return 'standard' // breezing: step scaffolding back down
  return currentTier // inside the band: keep going as-is
}

/** Tier for a node the learner is opening for the first time in this enrollment. */
export async function tierForNextNode(db: Db, progressId: string): Promise<ScaffoldingTier> {
  const [latest] = await db
    .select({ tier: userNodeStates.scaffoldingTier })
    .from(userNodeStates)
    .where(and(eq(userNodeStates.userTopicProgressId, progressId), isNotNull(userNodeStates.startedAt)))
    .orderBy(desc(userNodeStates.startedAt))
    .limit(1)
  return chooseTier(await successSignal(db, progressId), latest?.tier ?? 'standard')
}
