import { and, asc, desc, eq, isNotNull, lte, sql } from 'drizzle-orm'
import type { EnrollmentDetail, EnrollmentSummary, RelatedTopicDto } from '@shared/api'
import type { Db } from '../db/client'
import { reviewItems, skeletonNodes, topicRelations, topics, userNodeStates, userTopicProgress } from '../db/schema'

/** Mastery-weighted: only mastered nodes count toward completion (Pedagogy #5). */
export function masteryPercent(mastered: number, total: number): number {
  return total === 0 ? 0 : Math.round((mastered / total) * 100)
}

export async function listEnrollments(db: Db, userId: string, now: Date): Promise<EnrollmentSummary[]> {
  const rows = await db
    .select({
      userTopicProgressId: userTopicProgress.id,
      topicId: topics.id,
      topicName: topics.name,
      topicDescription: topics.description,
      status: userTopicProgress.status,
      startedAt: userTopicProgress.startedAt,
      lastActivityAt: userTopicProgress.lastActivityAt,
      nodeCount: sql<number>`(select count(*)::int from ${userNodeStates} uns where uns.user_topic_progress_id = ${userTopicProgress.id})`,
      masteredCount: sql<number>`(select count(*)::int from ${userNodeStates} uns where uns.user_topic_progress_id = ${userTopicProgress.id} and uns.status = 'mastered')`,
      startedCount: sql<number>`(select count(*)::int from ${userNodeStates} uns where uns.user_topic_progress_id = ${userTopicProgress.id} and uns.started_at is not null)`,
      dueReviewCount: sql<number>`(select count(*)::int from ${reviewItems} ri join ${userNodeStates} uns on uns.id = ri.user_node_state_id where uns.user_topic_progress_id = ${userTopicProgress.id} and ri.last_rated_at is not null and ri.due <= ${now.toISOString()}::timestamptz)`,
    })
    .from(userTopicProgress)
    .innerJoin(topics, eq(topics.id, userTopicProgress.topicId))
    .where(eq(userTopicProgress.userId, userId))
    .orderBy(desc(userTopicProgress.lastActivityAt))

  return rows.map((r) => ({
    userTopicProgressId: r.userTopicProgressId,
    topicId: r.topicId,
    topicName: r.topicName,
    topicDescription: r.topicDescription,
    status: r.status,
    percentComplete: masteryPercent(r.masteredCount, r.nodeCount),
    masteredCount: r.masteredCount,
    startedCount: r.startedCount,
    nodeCount: r.nodeCount,
    dueReviewCount: r.dueReviewCount,
    startedAt: r.startedAt.toISOString(),
  }))
}

/** The user's most recent enrollment in a topic (v1 has one canonical skeleton per topic). */
export async function findEnrollmentForTopic(db: Db, userId: string, topicId: string) {
  const [row] = await db
    .select()
    .from(userTopicProgress)
    .where(and(eq(userTopicProgress.userId, userId), eq(userTopicProgress.topicId, topicId)))
    .orderBy(desc(userTopicProgress.startedAt))
    .limit(1)
  return row ?? null
}

export async function enrollmentDetail(db: Db, userId: string, topicId: string, now: Date): Promise<EnrollmentDetail | null> {
  const progress = await findEnrollmentForTopic(db, userId, topicId)
  if (!progress) return null
  const summary = (await listEnrollments(db, userId, now)).find((e) => e.userTopicProgressId === progress.id)
  if (!summary) return null

  const nodeRows = await db
    .select({
      biteId: userNodeStates.id,
      skeletonNodeId: skeletonNodes.id,
      orderIndex: skeletonNodes.orderIndex,
      title: skeletonNodes.title,
      objective: skeletonNodes.objective,
      riskTier: skeletonNodes.riskTier,
      scaffoldsOn: skeletonNodes.scaffoldsOn,
      status: userNodeStates.status,
    })
    .from(userNodeStates)
    .innerJoin(skeletonNodes, eq(skeletonNodes.id, userNodeStates.skeletonNodeId))
    .where(eq(userNodeStates.userTopicProgressId, progress.id))
    .orderBy(asc(skeletonNodes.orderIndex))
  const titleById = new Map(nodeRows.map((n) => [n.skeletonNodeId, n.title]))

  const related = await db
    .select({ topicId: topics.id, name: topics.name, relationType: topicRelations.relationType, reason: topicRelations.reason })
    .from(topicRelations)
    .innerJoin(topics, eq(topics.id, topicRelations.toTopicId))
    .where(eq(topicRelations.fromTopicId, topicId))
    .orderBy(asc(topics.name))

  return {
    ...summary,
    baseline: progress.selfReportedBaseline,
    nodes: nodeRows.map((n) => ({
      biteId: n.biteId,
      orderIndex: n.orderIndex,
      title: n.title,
      objective: n.objective,
      riskTier: n.riskTier,
      status: n.status,
      prerequisiteTitles: n.scaffoldsOn.map((id) => titleById.get(id)).filter((t): t is string => Boolean(t)),
    })),
    relatedTopics: related satisfies RelatedTopicDto[],
  }
}

export async function countDueReviews(db: Db, userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewItems)
    .where(and(eq(reviewItems.userId, userId), isNotNull(reviewItems.lastRatedAt), lte(reviewItems.due, now)))
  return row?.n ?? 0
}

