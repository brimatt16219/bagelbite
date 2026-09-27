/**
 * Session composer (Architecture "Session composer"): decides what a learner does next in a
 * topic. Due reviews take priority over new content so review debt can't pile up behind new-bite
 * momentum; then the bite they are part-way through; then the next unlocked bite. Interleaving is
 * v1-deferred.
 */
import { and, asc, eq, gt, isNotNull, lte, min, sql } from 'drizzle-orm'
import type { DueReviewDto, NextStep } from '@shared/api'
import type { Db } from '../db/client'
import {
  curriculumSkeletons,
  retrievalPromptBankItems,
  reviewItems,
  skeletonNodes,
  topics,
  userNodeStates,
  userTopicProgress,
} from '../db/schema'

function dueReviewsQuery(db: Db, userId: string, now: Date, topicId?: string) {
  return db
    .select({
      reviewItemId: reviewItems.id,
      promptId: retrievalPromptBankItems.id,
      prompt: retrievalPromptBankItems.prompt,
      kind: retrievalPromptBankItems.kind,
      biteId: userNodeStates.id,
      topicId: topics.id,
      topicName: topics.name,
      nodeTitle: skeletonNodes.title,
      due: reviewItems.due,
      progressId: userTopicProgress.id,
    })
    .from(reviewItems)
    .innerJoin(retrievalPromptBankItems, eq(retrievalPromptBankItems.id, reviewItems.retrievalPromptBankItemId))
    .innerJoin(userNodeStates, eq(userNodeStates.id, reviewItems.userNodeStateId))
    .innerJoin(userTopicProgress, eq(userTopicProgress.id, userNodeStates.userTopicProgressId))
    .innerJoin(skeletonNodes, eq(skeletonNodes.id, userNodeStates.skeletonNodeId))
    .innerJoin(curriculumSkeletons, eq(curriculumSkeletons.id, skeletonNodes.curriculumSkeletonId))
    .innerJoin(topics, eq(topics.id, curriculumSkeletons.topicId))
    .where(
      and(
        eq(reviewItems.userId, userId),
        isNotNull(reviewItems.lastRatedAt),
        lte(reviewItems.due, now),
        topicId ? eq(topics.id, topicId) : undefined,
      ),
    )
    .orderBy(asc(reviewItems.due))
}

/** Due review items across all topics (or one topic), oldest-due first. */
export async function dueReviews(db: Db, userId: string, now: Date, topicId?: string, limit = 50): Promise<DueReviewDto[]> {
  const rows = await dueReviewsQuery(db, userId, now, topicId).limit(limit)
  return rows.map(({ due, progressId: _progressId, ...r }) => ({ ...r, dueAt: due.toISOString() }))
}

export async function nextStep(db: Db, progressId: string, now: Date): Promise<NextStep> {
  const [due] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewItems)
    .innerJoin(userNodeStates, eq(userNodeStates.id, reviewItems.userNodeStateId))
    .where(and(eq(userNodeStates.userTopicProgressId, progressId), isNotNull(reviewItems.lastRatedAt), lte(reviewItems.due, now)))
  if (due.n > 0) return { type: 'reviews', dueCount: due.n }

  const nodes = await db
    .select({
      id: userNodeStates.id,
      status: userNodeStates.status,
      teachingCompletedAt: userNodeStates.teachingCompletedAt,
      title: skeletonNodes.title,
    })
    .from(userNodeStates)
    .innerJoin(skeletonNodes, eq(skeletonNodes.id, userNodeStates.skeletonNodeId))
    .where(eq(userNodeStates.userTopicProgressId, progressId))
    .orderBy(asc(skeletonNodes.orderIndex))

  const unfinished = nodes.find((n) => n.status === 'in_progress' && !n.teachingCompletedAt)
  if (unfinished) return { type: 'bite', biteId: unfinished.id, title: unfinished.title }
  const next = nodes.find((n) => n.status === 'available')
  if (next) return { type: 'bite', biteId: next.id, title: next.title }
  if (nodes.length && nodes.every((n) => n.status === 'mastered')) return { type: 'completed' }

  const [upcoming] = await db
    .select({ at: min(reviewItems.due) })
    .from(reviewItems)
    .innerJoin(userNodeStates, eq(userNodeStates.id, reviewItems.userNodeStateId))
    .where(and(eq(userNodeStates.userTopicProgressId, progressId), isNotNull(reviewItems.lastRatedAt), gt(reviewItems.due, now)))
  return {
    type: 'waiting',
    nextReviewAt: upcoming?.at ? new Date(upcoming.at).toISOString() : null,
    message: 'You have worked through every unlocked bite. The next ones unlock once your earlier bites are mastered through spaced review.',
  }
}

