/**
 * "Report an issue" flags on shared content (Content-Accuracy §6, Content-Sharing §5).
 *
 * - A flag targets the SHARED lesson variant / retrieval prompt / exercise the learner was shown,
 *   so a confirmed fix applies to every learner who sees it.
 * - High-risk (security-adjacent) content is suppressed on a single flag; the next view of that
 *   (node, tier) regenerates it (still grounded and verified). Low/medium flags only log, so one
 *   confused or bad-faith report can't pull correct content.
 * - Review is a manual habit, not built tooling (Content-Accuracy §4): `npm run flags` lists open
 *   flags; confirming one retires the content, dismissing one restores anything it suppressed.
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { FlagRequest, FlagResult } from '@shared/api'
import type { Db } from '../db/client'
import { contentFlags, exerciseBankItems, lessonVariants, retrievalPromptBankItems } from '../db/schema'
import type { Clock } from '../lib/clock'
import { notFound } from '../lib/errors'
import { loadOwnedNodeState } from '../learning/bites'

type TargetType = FlagRequest['targetType']

const tables = {
  lesson_variant: lessonVariants,
  retrieval_prompt: retrievalPromptBankItems,
  exercise: exerciseBankItems,
} as const

async function targetNodeId(db: Db, targetType: TargetType, targetId: string): Promise<string | null> {
  const table = tables[targetType]
  const [row] = await db.select({ nodeId: table.skeletonNodeId }).from(table).where(eq(table.id, targetId))
  return row?.nodeId ?? null
}

async function setSuppressed(db: Db, targetType: TargetType, targetId: string, at: Date | null) {
  const table = tables[targetType]
  await db.update(table).set({ suppressedAt: at }).where(eq(table.id, targetId))
}

export async function flagContent(deps: { db: Db; clock: Clock }, userId: string, biteId: string, body: FlagRequest): Promise<FlagResult> {
  const { db, clock } = deps
  const owned = await loadOwnedNodeState(db, userId, biteId)
  // The flagged item must be content from this bite's node.
  if ((await targetNodeId(db, body.targetType, body.targetId)) !== owned.state.skeletonNodeId) throw notFound('Content')

  const [existing] = await db
    .select({ id: contentFlags.id })
    .from(contentFlags)
    .where(
      and(
        eq(contentFlags.userId, userId),
        eq(contentFlags.targetType, body.targetType),
        eq(contentFlags.targetId, body.targetId),
        eq(contentFlags.status, 'open'),
      ),
    )
  if (existing) return { flagId: existing.id }

  const now = clock.now()
  const [flag] = await db
    .insert(contentFlags)
    .values({
      targetType: body.targetType,
      targetId: body.targetId,
      userId,
      userNodeStateId: owned.state.id,
      reason: body.reason?.trim() || null,
      riskTierAtFlag: owned.node.riskTier,
      createdAt: now,
    })
    .returning({ id: contentFlags.id })
  if (owned.node.riskTier === 'high') await setSuppressed(db, body.targetType, body.targetId, now)
  return { flagId: flag.id }
}

// ---------------------------------------------------------------- manual review (scripts/flags.ts)

export async function listOpenFlags(db: Db) {
  return db.select().from(contentFlags).where(eq(contentFlags.status, 'open')).orderBy(asc(contentFlags.createdAt))
}

/**
 * Confirmed wrong: retire the content. A lesson variant is suppressed so the next view regenerates a
 * new version (superseding this one); a prompt/exercise is superseded so it's never selected again.
 */
export async function confirmFlag(db: Db, flagId: string, note: string | null, now: Date) {
  const [flag] = await db.select().from(contentFlags).where(eq(contentFlags.id, flagId))
  if (!flag) throw notFound('Flag')
  if (flag.targetType === 'lesson_variant') {
    await db.update(lessonVariants).set({ suppressedAt: now }).where(and(eq(lessonVariants.id, flag.targetId), isNull(lessonVariants.suppressedAt)))
  } else {
    const table = tables[flag.targetType]
    await db.update(table).set({ supersededAt: now }).where(eq(table.id, flag.targetId))
  }
  await db
    .update(contentFlags)
    .set({ status: 'reviewed', resolutionNote: note, reviewedAt: now })
    .where(and(eq(contentFlags.targetType, flag.targetType), eq(contentFlags.targetId, flag.targetId), eq(contentFlags.status, 'open')))
  return flag
}

/** Not a real problem: close it, and lift a suppression if no other open flag still applies. */
export async function dismissFlag(db: Db, flagId: string, note: string | null, now: Date) {
  const [flag] = await db.select().from(contentFlags).where(eq(contentFlags.id, flagId))
  if (!flag) throw notFound('Flag')
  await db.update(contentFlags).set({ status: 'dismissed', resolutionNote: note, reviewedAt: now }).where(eq(contentFlags.id, flagId))
  const stillOpen = await db
    .select({ id: contentFlags.id })
    .from(contentFlags)
    .where(and(eq(contentFlags.targetType, flag.targetType), eq(contentFlags.targetId, flag.targetId), eq(contentFlags.status, 'open')))
  const table = tables[flag.targetType]
  const [target] = await db.select({ supersededAt: table.supersededAt }).from(table).where(eq(table.id, flag.targetId))
  if (!stillOpen.length && target && !target.supersededAt) await setSuppressed(db, flag.targetType, flag.targetId, null)
  return flag
}
