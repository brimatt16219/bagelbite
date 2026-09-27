/**
 * Shared lesson content, generated lazily per (SkeletonNode, scaffoldingTier) and cached forever
 * (Content-Sharing §4). This is also where the content-accuracy floor runs (Content-Accuracy):
 *   low tier    → generate from parametric knowledge, no grounding;
 *   medium tier → fresh Tavily grounding first + self-cited `claims`;
 *   high tier   → grounding + an independent verification call; on failure regenerate once with
 *                 the concerns, and if it still fails, hedge the flagged statements.
 * Exercises are spec-validated in a sandbox; invalid ones get one repair attempt, then are dropped.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { ScaffoldingTier } from '@shared/api'
import type { Db } from '../db/client'
import {
  curriculumSkeletons,
  exerciseBankItems,
  lessonVariants,
  retrievalPromptBankItems,
  skeletonNodes,
  topicRelations,
  topics,
  type GroundingSource,
  type GroundingStatus,
  type Verification,
} from '../db/schema'
import type { AiService, ExerciseDraft, LessonDraft, LessonInput } from '../ai/types'
import { UpstreamError } from '../lib/errors'
import type { Clock } from '../lib/clock'
import { GroundingUnavailableError, type GroundingClient } from '../grounding/tavily'
import type { ExerciseValidator } from './exerciseValidator'
import { extractWikiLinks } from './wikiLinks'
import { normalizeTopicName } from './topicNames'

export interface LessonDeps {
  db: Db
  ai: AiService
  grounding: GroundingClient
  validator: ExerciseValidator
  clock: Clock
}

export type LessonVariantRow = typeof lessonVariants.$inferSelect

const inflight = new Map<string, Promise<LessonVariantRow>>()

/**
 * Returns the current, unsuppressed lesson variant for (node, tier), generating it on first
 * request. Concurrent requests for the same pair in this process share one generation; across
 * processes the partial unique index keeps a single current row.
 */
export async function ensureLessonVariant(
  deps: LessonDeps,
  nodeId: string,
  tier: ScaffoldingTier,
  userId: string,
): Promise<{ variant: LessonVariantRow; cacheHit: boolean }> {
  const current = await currentVariant(deps.db, nodeId, tier)
  if (current && !current.suppressedAt) return { variant: current, cacheHit: true }

  const key = `${nodeId}:${tier}`
  let pending = inflight.get(key)
  if (!pending) {
    pending = generateVariant(deps, nodeId, tier, userId, current).finally(() => inflight.delete(key))
    inflight.set(key, pending)
  }
  return { variant: await pending, cacheHit: false }
}

async function currentVariant(db: Db, nodeId: string, tier: ScaffoldingTier): Promise<LessonVariantRow | null> {
  const [row] = await db
    .select()
    .from(lessonVariants)
    .where(and(eq(lessonVariants.skeletonNodeId, nodeId), eq(lessonVariants.scaffoldingTier, tier), isNull(lessonVariants.supersededAt)))
  return row ?? null
}

async function loadNodeContext(db: Db, nodeId: string) {
  const [node] = await db
    .select({
      id: skeletonNodes.id,
      title: skeletonNodes.title,
      objective: skeletonNodes.objective,
      riskTier: skeletonNodes.riskTier,
      scaffoldsOn: skeletonNodes.scaffoldsOn,
      topicId: topics.id,
      topicName: topics.name,
    })
    .from(skeletonNodes)
    .innerJoin(curriculumSkeletons, eq(curriculumSkeletons.id, skeletonNodes.curriculumSkeletonId))
    .innerJoin(topics, eq(topics.id, curriculumSkeletons.topicId))
    .where(eq(skeletonNodes.id, nodeId))
  if (!node) throw new Error(`Skeleton node ${nodeId} not found`)
  const prereqs = node.scaffoldsOn.length
    ? await db
        .select({ title: skeletonNodes.title })
        .from(skeletonNodes)
        .where(inArray(skeletonNodes.id, node.scaffoldsOn))
        .orderBy(asc(skeletonNodes.orderIndex))
    : []
  return { ...node, prerequisiteTitles: prereqs.map((p) => p.title) }
}

async function groundingFor(deps: LessonDeps, query: string, riskTier: string, userId: string): Promise<{ status: GroundingStatus; sources: GroundingSource[] | null }> {
  if (riskTier === 'low') return { status: 'not_required', sources: null }
  let sources: GroundingSource[] | null
  try {
    sources = await deps.grounding.search(query, { userId })
  } catch (err) {
    if (err instanceof GroundingUnavailableError) {
      // Fail closed: shared content is cached forever, so never cache ungrounded medium/high content.
      throw new UpstreamError("Couldn't check sources for this bite right now. Try again in a moment.", err)
    }
    throw err
  }
  return sources?.length ? { status: 'grounded', sources } : { status: 'unavailable', sources: null }
}

/** Validates exercises; gives invalid ones one repair round; returns only the valid ones. */
async function validExercises(deps: LessonDeps, input: LessonInput, lesson: LessonDraft, userId: string): Promise<ExerciseDraft[]> {
  if (!deps.validator.enabled) return lesson.exercises
  const results = await Promise.all(lesson.exercises.map((e) => deps.validator.validate(e)))
  const valid = lesson.exercises.filter((_, i) => results[i].ok)
  const failures = lesson.exercises
    .map((exercise, i) => ({ exercise, result: results[i] }))
    .filter((f): f is { exercise: ExerciseDraft; result: { ok: false; problem: string } } => !f.result.ok)
    .map((f) => ({ exercise: f.exercise, problem: f.result.problem }))
  if (!failures.length) return valid

  const repaired = await deps.ai.repairExercises({ ...input, explanationMarkdown: lesson.explanationMarkdown, failures }, { userId })
  const repairedResults = await Promise.all(repaired.map((e) => deps.validator.validate(e)))
  const stillInvalid = repairedResults.filter((r) => !r.ok) as { ok: false; problem: string }[]
  if (stillInvalid.length) {
    // A content-quality bug to notice and fix in the prompt (MVP-Synthesis flag 5) — never shipped.
    console.warn(`[content] dropped ${stillInvalid.length} exercise(s) for "${input.nodeTitle}": ${stillInvalid.map((r) => r.problem).join(' | ')}`)
  }
  return [...valid, ...repaired.filter((_, i) => repairedResults[i].ok)]
}

async function generateVariant(
  deps: LessonDeps,
  nodeId: string,
  tier: ScaffoldingTier,
  userId: string,
  previous: LessonVariantRow | null,
): Promise<LessonVariantRow> {
  const node = await loadNodeContext(deps.db, nodeId)
  const grounding = await groundingFor(deps, `${node.topicName} ${node.title}: ${node.objective}`, node.riskTier, userId)
  const input: LessonInput = {
    topicName: node.topicName,
    nodeTitle: node.title,
    objective: node.objective,
    riskTier: node.riskTier,
    tier,
    prerequisiteTitles: node.prerequisiteTitles,
    grounding: grounding.sources,
  }

  let lesson = await deps.ai.generateLesson(input, { userId })
  let exercises = await validExercises(deps, input, lesson, userId)
  let verification: Verification | null = null

  if (node.riskTier === 'high') {
    const verifyInput = () => ({ ...input, explanationMarkdown: lesson.explanationMarkdown, exercises, nodeTitle: node.title })
    let check = await deps.ai.verifyLesson(verifyInput(), { userId })
    let attempts = 1
    if (!check.passed) {
      // Regenerate once with the reviewer's concerns fed back (Content-Accuracy §3).
      const revised = { ...input, revisionNotes: check.concerns }
      lesson = await deps.ai.generateLesson(revised, { userId })
      exercises = await validExercises(deps, revised, lesson, userId)
      check = await deps.ai.verifyLesson(verifyInput(), { userId })
      attempts = 2
    }
    if (check.passed) {
      verification = { status: 'passed', concerns: [], attempts }
    } else {
      // Still failing: ship a hedged version of the flagged statements, never the unverified specifics.
      const hedged = await deps.ai.hedgeLesson({ ...verifyInput(), concerns: check.concerns }, { userId })
      lesson = { ...lesson, explanationMarkdown: hedged.explanationMarkdown, claims: [] }
      verification = { status: 'hedged', concerns: check.concerns, attempts }
    }
  }

  const now = deps.clock.now()
  const variant = await deps.db.transaction(async (tx) => {
    if (previous) {
      await tx.update(lessonVariants).set({ supersededAt: now }).where(eq(lessonVariants.id, previous.id))
    }
    const [row] = await tx
      .insert(lessonVariants)
      .values({
        skeletonNodeId: nodeId,
        scaffoldingTier: tier,
        explanationMarkdown: lesson.explanationMarkdown,
        groundingStatus: grounding.status,
        groundingSources: grounding.sources,
        claims: grounding.sources ? lesson.claims : null,
        verification,
        version: (previous?.version ?? 0) + 1,
        contentSource: deps.ai.source,
        generatedAt: now,
      })
      .onConflictDoNothing()
      .returning()
    if (!row) return null // another process generated this (node, tier) concurrently

    await tx.insert(retrievalPromptBankItems).values(
      lesson.prompts.map((p) => ({
        skeletonNodeId: nodeId,
        generatedWithLessonVariantId: row.id,
        prompt: p.prompt,
        kind: p.kind,
        answerKey: p.answerKey,
        suitableTiers: p.suitableTiers.includes(tier) ? p.suitableTiers : [...p.suitableTiers, tier],
        anticipatedMisconceptions: p.anticipatedMisconceptions,
        contentSource: deps.ai.source,
        createdAt: now,
      })),
    )
    if (exercises.length) {
      await tx.insert(exerciseBankItems).values(
        exercises.map((e) => ({
          skeletonNodeId: nodeId,
          generatedWithLessonVariantId: row.id,
          componentType: 'code_exercise' as const,
          instructions: e.instructions,
          starterCode: e.starterCode,
          solutionCode: e.solutionCode,
          testSpec: e.testSpec,
          suitableTiers: e.suitableTiers.includes(tier) ? e.suitableTiers : [...e.suitableTiers, tier],
          contentSource: deps.ai.source,
          validatedAt: now,
          createdAt: now,
        })),
      )
    }
    await recordWikiLinks(tx as unknown as Db, node.topicId, node.title, lesson.explanationMarkdown)
    return row
  })

  if (variant) return variant
  const winner = await currentVariant(deps.db, nodeId, tier)
  if (!winner) throw new UpstreamError("Couldn't prepare this bite right now. Try again in a moment.", 'variant race lost with no winner')
  return winner
}

async function recordWikiLinks(db: Db, topicId: string, nodeTitle: string, markdown: string) {
  for (const name of extractWikiLinks(markdown)) {
    const normalizedName = normalizeTopicName(name)
    if (!normalizedName) continue
    await db.insert(topics).values({ name, normalizedName }).onConflictDoNothing({ target: topics.normalizedName })
    const [target] = await db.select({ id: topics.id }).from(topics).where(eq(topics.normalizedName, normalizedName))
    if (!target || target.id === topicId) continue
    await db
      .insert(topicRelations)
      .values({ fromTopicId: topicId, toTopicId: target.id, relationType: 'related', reason: `Referenced in the lesson "${nodeTitle}".` })
      .onConflictDoNothing()
  }
}
