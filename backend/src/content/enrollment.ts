/**
 * Enrollment + topic scoping (Product-Spec flow 1, Topic-Scoping.md, Content-Sharing.md).
 *
 * 1. Exact normalized-name match on a topic that already has a canonical skeleton → reuse it,
 *    no Claude call (the shared-curriculum cache path).
 * 2. Otherwise one scoping/skeleton call (Sonnet) that either resolves the topic (optionally to an
 *    existing similar topic — dedup), disambiguates an umbrella topic into 3–4 candidates (nothing
 *    is written), or rejects an out-of-vertical topic.
 * 3. A resolved topic gets a shared CurriculumSkeleton (once, ever) + TopicRelations, then this
 *    user gets a UserTopicProgress pinned to the skeleton version and one UserNodeState per node.
 */
import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import type { EnrollResponse } from '@shared/api'
import type { Db } from '../db/client'
import {
  curriculumSkeletons,
  skeletonNodes,
  topicRelations,
  topics,
  userNodeStates,
  userTopicProgress,
} from '../db/schema'
import type { AiService, NodeDraft, RelatedTopicDraft } from '../ai/types'
import { AiOutputError } from '../ai/schemas'
import type { Clock } from '../lib/clock'
import { normalizeTopicName, significantWords } from './topicNames'

export interface EnrollmentDeps {
  db: Db
  ai: AiService
  clock: Clock
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

interface SkeletonRef {
  topicId: string
  topicName: string
  skeletonId: string
  version: number
}

export async function enroll(deps: EnrollmentDeps, userId: string, topicText: string, baseline: string): Promise<EnrollResponse> {
  const normalized = normalizeTopicName(topicText)
  if (!normalized) {
    return { status: 'unsupported', message: 'Type a programming or tech topic to get started.' }
  }

  // 1. Cache path: an identically named topic that already has a shared skeleton.
  const existing = await findTopicWithSkeleton(deps.db, eq(topics.normalizedName, normalized))
  if (existing) return enrollInSkeleton(deps, userId, existing, baseline)

  // 2. One scoping + skeleton call.
  const similarTopics = await findSimilarTopics(deps.db, topicText)
  const scope = await deps.ai.scope({ topic: topicText, baseline, similarTopics }, { userId })
  if (scope.status !== 'resolved') return scope

  // 3. Resolve to a topic row, reusing an existing one (matched id or same canonical name) if possible.
  const matchedCondition = scope.matchedExistingTopicId
    ? eq(topics.id, scope.matchedExistingTopicId)
    : eq(topics.normalizedName, normalizeTopicName(scope.topicName))
  const reusable = await findTopicWithSkeleton(deps.db, matchedCondition)
  if (reusable) return enrollInSkeleton(deps, userId, reusable, baseline)

  if (scope.nodes.length === 0) throw new AiOutputError('Resolved topic has no curriculum nodes')
  const skeleton = await createSharedSkeleton(deps, userId, scope.topicName, scope.topicDescription, scope.nodes, scope.relatedTopics, scope.matchedExistingTopicId)
  return enrollInSkeleton(deps, userId, skeleton, baseline)
}

async function findTopicWithSkeleton(db: Db, condition: ReturnType<typeof eq>): Promise<SkeletonRef | null> {
  const [row] = await db
    .select({
      topicId: topics.id,
      topicName: topics.name,
      skeletonId: curriculumSkeletons.id,
      version: curriculumSkeletons.version,
    })
    .from(topics)
    .innerJoin(
      curriculumSkeletons,
      and(
        eq(curriculumSkeletons.topicId, topics.id),
        eq(curriculumSkeletons.visibility, 'canonical'),
        isNull(curriculumSkeletons.supersededAt),
      ),
    )
    .where(condition)
    .limit(1)
  return row ?? null
}

async function findSimilarTopics(db: Db, topicText: string) {
  const words = significantWords(topicText)
  if (!words.length) return []
  return db
    .select({ id: topics.id, name: topics.name })
    .from(topics)
    .where(or(...words.map((w) => ilike(topics.normalizedName, `%${w}%`))))
    .orderBy(asc(topics.name))
    .limit(12)
}

/** Finds or creates a topic by canonical name inside a transaction. */
async function upsertTopic(tx: Tx, name: string, description: string, userId: string): Promise<string> {
  const normalizedName = normalizeTopicName(name)
  const [inserted] = await tx
    .insert(topics)
    .values({ name, normalizedName, description, createdByUserId: userId })
    .onConflictDoNothing({ target: topics.normalizedName })
    .returning({ id: topics.id })
  if (inserted) return inserted.id
  const [row] = await tx.select({ id: topics.id, description: topics.description }).from(topics).where(eq(topics.normalizedName, normalizedName))
  // Stub topics (created as related-topic suggestions) get a real description once scoped.
  if (description && !row.description) await tx.update(topics).set({ description }).where(eq(topics.id, row.id))
  return row.id
}

async function createSharedSkeleton(
  deps: EnrollmentDeps,
  userId: string,
  topicName: string,
  topicDescription: string,
  nodes: NodeDraft[],
  related: RelatedTopicDraft[],
  matchedTopicId: string | null,
): Promise<SkeletonRef> {
  const created = await deps.db.transaction(async (tx) => {
    const topicId = matchedTopicId ?? (await upsertTopic(tx, topicName, topicDescription, userId))
    const [topicRow] = await tx.select({ name: topics.name }).from(topics).where(eq(topics.id, topicId))

    const [skeleton] = await tx
      .insert(curriculumSkeletons)
      .values({ topicId, version: 1, contentSource: deps.ai.source, createdAt: deps.clock.now() })
      // Partial unique index: at most one current canonical skeleton per topic.
      .onConflictDoNothing()
      .returning({ id: curriculumSkeletons.id, version: curriculumSkeletons.version })
    if (!skeleton) return { topicId, topicName: topicRow.name, skeletonId: null, version: 0 }

    // Node ids are assigned up front so scaffoldsOn indices can become id references.
    const ids = nodes.map(() => crypto.randomUUID())
    await tx.insert(skeletonNodes).values(
      nodes.map((n, i) => ({
        id: ids[i],
        curriculumSkeletonId: skeleton.id,
        orderIndex: i,
        title: n.title,
        objective: n.objective,
        riskTier: n.riskTier,
        scaffoldsOn: n.scaffoldsOn.map((j) => ids[j]),
      })),
    )

    // Topic graph data capture (the graph screen itself is v1-deferred). Edges point from the
    // enrolled topic to the suggested topic; relationType describes the suggested topic's role.
    for (const r of related) {
      const relatedId = await upsertTopic(tx, r.name, r.description, userId)
      if (relatedId === topicId) continue
      await tx
        .insert(topicRelations)
        .values({ fromTopicId: topicId, toTopicId: relatedId, relationType: r.relationType, reason: r.reason })
        .onConflictDoNothing()
    }
    return { topicId, topicName: topicRow.name, skeletonId: skeleton.id, version: skeleton.version }
  })

  if (created.skeletonId) return created as SkeletonRef
  // Lost a race with a concurrent first enrollment — use the skeleton that won.
  const winner = await findTopicWithSkeleton(deps.db, eq(topics.id, created.topicId))
  if (!winner) throw new AiOutputError('Skeleton creation conflicted but no skeleton exists')
  return winner
}

async function enrollInSkeleton(deps: EnrollmentDeps, userId: string, ref: SkeletonRef, baseline: string): Promise<EnrollResponse> {
  const now = deps.clock.now()
  const result = await deps.db.transaction(async (tx) => {
    const [progress] = await tx
      .insert(userTopicProgress)
      .values({
        userId,
        topicId: ref.topicId,
        curriculumSkeletonId: ref.skeletonId,
        curriculumSkeletonVersion: ref.version,
        selfReportedBaseline: baseline,
        startedAt: now,
        lastActivityAt: now,
      })
      .onConflictDoNothing({ target: [userTopicProgress.userId, userTopicProgress.curriculumSkeletonId] })
      .returning({ id: userTopicProgress.id })

    if (!progress) {
      const [existingProgress] = await tx
        .select({ id: userTopicProgress.id })
        .from(userTopicProgress)
        .where(and(eq(userTopicProgress.userId, userId), eq(userTopicProgress.curriculumSkeletonId, ref.skeletonId)))
      return { progressId: existingProgress.id, alreadyEnrolled: true }
    }

    const nodes = await tx
      .select({ id: skeletonNodes.id, scaffoldsOn: skeletonNodes.scaffoldsOn })
      .from(skeletonNodes)
      .where(eq(skeletonNodes.curriculumSkeletonId, ref.skeletonId))
    if (nodes.length) {
      await tx.insert(userNodeStates).values(
        nodes.map((n) => ({
          userTopicProgressId: progress.id,
          skeletonNodeId: n.id,
          // Mastery gate: nodes with prerequisites stay locked until those are mastered.
          status: n.scaffoldsOn.length === 0 ? ('available' as const) : ('locked' as const),
          createdAt: now,
        })),
      )
    }
    return { progressId: progress.id, alreadyEnrolled: false }
  })

  return {
    status: 'resolved',
    topicId: ref.topicId,
    topicName: ref.topicName,
    userTopicProgressId: result.progressId,
    firstBiteId: await firstOpenBite(deps.db, result.progressId),
    alreadyEnrolled: result.alreadyEnrolled,
  }
}

/** The earliest node (by curriculum order) that is unlocked and not yet mastered. */
export async function firstOpenBite(db: Db, progressId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: userNodeStates.id })
    .from(userNodeStates)
    .innerJoin(skeletonNodes, eq(skeletonNodes.id, userNodeStates.skeletonNodeId))
    .where(and(eq(userNodeStates.userTopicProgressId, progressId), inArray(userNodeStates.status, ['available', 'in_progress'])))
    .orderBy(sql`case when ${userNodeStates.status} = 'in_progress' then 0 else 1 end`, asc(skeletonNodes.orderIndex))
    .limit(1)
  return row?.id ?? null
}
