/**
 * Bite composition (Content-Sharing §2): a "bite" is not a stored row — it is composed on read
 * from this learner's UserNodeState (tier, selections, progress) plus the shared LessonVariant and
 * the selected bank items. `GET /bites/:id` takes a UserNodeState id.
 */
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { AnsweredPromptDto, BiteDto, CitationDto, ConfidenceRating, ScaffoldingTier } from '@shared/api'
import type { Db } from '../db/client'
import {
  biteAttempts,
  biteViewEvents,
  curriculumSkeletons,
  exerciseBankItems,
  retrievalPromptBankItems,
  reviewItems,
  reviewLogs,
  skeletonNodes,
  topics,
  userNodeStates,
  userTopicProgress,
} from '../db/schema'
import { ensureLessonVariant, type LessonDeps, type LessonVariantRow } from '../content/lessons'
import { HttpError, notFound } from '../lib/errors'
import { tierForNextNode } from './adaptive'
import { touchSession } from './sessions'

export const PROMPTS_PER_BITE = 3
export const FAILED_ATTEMPTS_BEFORE_REVEAL = 3

export type OwnedNodeState = Awaited<ReturnType<typeof loadOwnedNodeState>>

/** Loads a UserNodeState with its node/topic context — 404 unless it belongs to this user. */
export async function loadOwnedNodeState(db: Db, userId: string, biteId: string) {
  const [row] = await db
    .select({
      state: userNodeStates,
      progress: userTopicProgress,
      node: skeletonNodes,
      topicId: topics.id,
      topicName: topics.name,
      nodeCount: sql<number>`(select count(*)::int from ${skeletonNodes} sn where sn.curriculum_skeleton_id = ${curriculumSkeletons.id})`,
    })
    .from(userNodeStates)
    .innerJoin(userTopicProgress, eq(userTopicProgress.id, userNodeStates.userTopicProgressId))
    .innerJoin(skeletonNodes, eq(skeletonNodes.id, userNodeStates.skeletonNodeId))
    .innerJoin(curriculumSkeletons, eq(curriculumSkeletons.id, skeletonNodes.curriculumSkeletonId))
    .innerJoin(topics, eq(topics.id, curriculumSkeletons.topicId))
    .where(and(eq(userNodeStates.id, biteId), eq(userTopicProgress.userId, userId)))
  if (!row) throw notFound('Bite')
  return row
}

export function splitSections(markdown: string): string[] {
  return markdown
    .split(/\n(?=## )/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function citationFor(variant: Pick<LessonVariantRow, 'groundingStatus' | 'groundingSources'>): CitationDto {
  if (variant.groundingStatus === 'grounded' && variant.groundingSources?.length) {
    return {
      kind: 'grounded',
      sources: variant.groundingSources.slice(0, 2).map((s) => ({ url: s.url, title: s.title, domain: domainOf(s.url) })),
    }
  }
  return { kind: 'ungrounded', reason: variant.groundingStatus === 'unavailable' ? 'grounding_unavailable' : 'low_risk' }
}

/** Active (not suppressed/superseded) bank items for a node that suit a tier, in generation order. */
async function activePrompts(db: Db, nodeId: string, tier: ScaffoldingTier) {
  return db
    .select()
    .from(retrievalPromptBankItems)
    .where(
      and(
        eq(retrievalPromptBankItems.skeletonNodeId, nodeId),
        isNull(retrievalPromptBankItems.suppressedAt),
        isNull(retrievalPromptBankItems.supersededAt),
        sql`${tier} = any(${retrievalPromptBankItems.suitableTiers})`,
      ),
    )
    .orderBy(asc(retrievalPromptBankItems.createdAt), asc(retrievalPromptBankItems.id))
}

async function activeExercises(db: Db, nodeId: string, tier: ScaffoldingTier) {
  return db
    .select()
    .from(exerciseBankItems)
    .where(
      and(
        eq(exerciseBankItems.skeletonNodeId, nodeId),
        isNull(exerciseBankItems.suppressedAt),
        isNull(exerciseBankItems.supersededAt),
        sql`${tier} = any(${exerciseBankItems.suitableTiers})`,
      ),
    )
    .orderBy(asc(exerciseBankItems.createdAt), asc(exerciseBankItems.id))
}

export async function composeBite(deps: LessonDeps, userId: string, biteId: string): Promise<BiteDto> {
  const { db, clock } = deps
  const owned = await loadOwnedNodeState(db, userId, biteId)
  let state = owned.state
  if (state.status === 'locked') {
    throw new HttpError(409, 'bite_locked', 'This bite unlocks once you have mastered the bites it builds on.')
  }
  const now = clock.now()

  // First open: assign the scaffolding tier from the adaptive signal, and start the node.
  if (!state.startedAt) {
    const tier = await tierForNextNode(db, state.userTopicProgressId)
    ;[state] = await db
      .update(userNodeStates)
      .set({ scaffoldingTier: tier, startedAt: now, status: state.status === 'available' ? 'in_progress' : state.status })
      .where(eq(userNodeStates.id, state.id))
      .returning()
  }

  const { variant, cacheHit } = await ensureLessonVariant(deps, state.skeletonNodeId, state.scaffoldingTier, userId)
  await db.insert(biteViewEvents).values({
    userId,
    userNodeStateId: state.id,
    skeletonNodeId: state.skeletonNodeId,
    scaffoldingTier: state.scaffoldingTier,
    cacheHit,
    createdAt: now,
  })
  if (!state.teachingCompletedAt) await touchSession(db, userId, now, 'new_content')
  await db.update(userTopicProgress).set({ lastActivityAt: now }).where(eq(userTopicProgress.id, state.userTopicProgressId))

  // Prompt selection: keep answered/still-active picks, top up to PROMPTS_PER_BITE from the pool
  // (a suppressed prompt is replaced unless it was already answered).
  const pool = await activePrompts(db, state.skeletonNodeId, state.scaffoldingTier)
  const poolById = new Map(pool.map((p) => [p.id, p]))
  const answered = await firstExposureAnswers(db, userId, state.selectedPromptIds)
  let selected = state.selectedPromptIds.filter((id) => poolById.has(id) || answered.has(id))
  if (!state.teachingCompletedAt && selected.length < PROMPTS_PER_BITE) {
    for (const p of pool) {
      if (selected.length >= PROMPTS_PER_BITE) break
      if (!selected.includes(p.id)) selected.push(p.id)
    }
  }
  const allPrompts = selected.length
    ? await db.select().from(retrievalPromptBankItems).where(inArray(retrievalPromptBankItems.id, selected))
    : []
  const promptById = new Map(allPrompts.map((p) => [p.id, p]))
  selected = selected.filter((id) => promptById.has(id))

  // Exercise selection: keep the current one unless it was suppressed.
  const exercises = await activeExercises(db, state.skeletonNodeId, state.scaffoldingTier)
  let exerciseId = state.selectedExerciseId
  if (!exerciseId || !exercises.some((e) => e.id === exerciseId)) exerciseId = exercises[0]?.id ?? null

  if (exerciseId !== state.selectedExerciseId || selected.join() !== state.selectedPromptIds.join()) {
    ;[state] = await db
      .update(userNodeStates)
      .set({ selectedPromptIds: selected, selectedExerciseId: exerciseId })
      .where(eq(userNodeStates.id, state.id))
      .returning()
  }
  const exercise = exerciseId ? exercises.find((e) => e.id === exerciseId) ?? null : null

  const attempts = exercise
    ? await db
        .select({ n: count(), passed: sql<boolean>`coalesce(bool_or(${biteAttempts.passed}), false)` })
        .from(biteAttempts)
        .where(and(eq(biteAttempts.userNodeStateId, state.id), eq(biteAttempts.exerciseBankItemId, exercise.id)))
    : [{ n: 0, passed: false }]
  const attemptCount = Number(attempts[0].n)
  const attemptsPassed = Boolean(attempts[0].passed)

  const sections = splitSections(variant.explanationMarkdown)
  return {
    id: state.id,
    topicId: owned.topicId,
    topicName: owned.topicName,
    node: {
      title: owned.node.title,
      objective: owned.node.objective,
      orderIndex: owned.node.orderIndex,
      nodeCount: owned.nodeCount,
      riskTier: owned.node.riskTier,
      prerequisiteTitles: await prerequisiteTitles(db, owned.node.scaffoldsOn),
    },
    status: state.status,
    scaffoldingTier: state.scaffoldingTier,
    contentSource: variant.contentSource,
    lesson: {
      id: variant.id,
      sections,
      citation: citationFor(variant),
      verification: variant.verification?.status ?? null,
    },
    prompts: selected.map((id, i) => {
      const p = promptById.get(id)!
      return {
        id: p.id,
        kind: p.kind,
        prompt: p.prompt,
        afterSection: Math.min(i, Math.max(sections.length - 1, 0)),
        answered: answered.get(p.id) ? { ...answered.get(p.id)!, answerKey: p.answerKey } : null,
      }
    }),
    exercise: exercise
      ? {
          id: exercise.id,
          instructions: exercise.instructions,
          starterCode: exercise.starterCode,
          testSpec: exercise.testSpec,
          solutionCode: state.solutionRevealedAt ? exercise.solutionCode : null,
        }
      : null,
    attempts: {
      count: attemptCount,
      passed: attemptsPassed,
      solutionRevealed: Boolean(state.solutionRevealedAt),
      canRevealSolution: !attemptsPassed && !state.solutionRevealedAt && attemptCount >= FAILED_ATTEMPTS_BEFORE_REVEAL,
    },
    teachingComplete: Boolean(state.teachingCompletedAt),
  }
}

async function prerequisiteTitles(db: Db, ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const rows = await db
    .select({ title: skeletonNodes.title })
    .from(skeletonNodes)
    .where(inArray(skeletonNodes.id, ids))
    .orderBy(asc(skeletonNodes.orderIndex))
  return rows.map((r) => r.title)
}

/** The learner's first-exposure answer per prompt (the one given while working through the bite). */
export async function firstExposureAnswers(
  db: Db,
  userId: string,
  promptIds: string[],
): Promise<Map<string, Omit<AnsweredPromptDto, 'answerKey'>>> {
  if (!promptIds.length) return new Map()
  const rows = await db
    .select({
      promptId: reviewItems.retrievalPromptBankItemId,
      logId: reviewLogs.id,
      response: reviewLogs.userResponse,
      correct: reviewLogs.correct,
      feedback: reviewLogs.feedback,
      confidence: reviewLogs.confidenceRating,
      rating: reviewLogs.rating,
    })
    .from(reviewLogs)
    .innerJoin(reviewItems, eq(reviewItems.id, reviewLogs.reviewItemId))
    .where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.isFirstExposure, true), inArray(reviewItems.retrievalPromptBankItemId, promptIds)))
  return new Map(
    rows.map((r) => [
      r.promptId,
      { logId: r.logId, response: r.response, correct: r.correct, feedback: r.feedback, confidence: r.confidence as ConfidenceRating, rating: r.rating },
    ]),
  )
}
