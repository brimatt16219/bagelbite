/**
 * In-bite chat tutor (Product-Spec flow 2 step 3; Cost-Model §6). Sonnet, streamed over SSE.
 * Context: the bite's shared lesson, the exercise instructions, the learner's current code and
 * latest test output, their self-described baseline, and only the last CHAT_HISTORY_CAP messages
 * (bounded input tokens for an inherently short-lived per-bite conversation).
 */
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import type { ChatMessageDto } from '@shared/api'
import type { Db } from '../db/client'
import { chatMessages, exerciseBankItems, lessonVariants } from '../db/schema'
import type { AiService } from '../ai/types'
import type { Clock } from '../lib/clock'
import { conflict, HttpError } from '../lib/errors'
import { loadOwnedNodeState } from './bites'
import { touchSession } from './sessions'

export const CHAT_HISTORY_CAP = 8

export interface ChatDeps {
  db: Db
  ai: AiService
  clock: Clock
}

export async function chatHistory(db: Db, userId: string, biteId: string): Promise<ChatMessageDto[]> {
  await loadOwnedNodeState(db, userId, biteId)
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.userNodeStateId, biteId))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.role))
  return rows.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() }))
}

/**
 * Validates and persists the learner's message, then returns a runner that streams the reply.
 * Split in two so validation errors can still be sent as normal JSON before SSE headers go out.
 */
export async function prepareTutorTurn(
  deps: ChatDeps,
  userId: string,
  biteId: string,
  input: { message: string; code?: string; testOutput?: string },
) {
  const { db, clock } = deps
  const owned = await loadOwnedNodeState(db, userId, biteId)
  if (owned.state.status === 'locked') throw new HttpError(409, 'bite_locked', 'This bite is still locked.')
  const [lesson] = await db
    .select()
    .from(lessonVariants)
    .where(
      and(
        eq(lessonVariants.skeletonNodeId, owned.state.skeletonNodeId),
        eq(lessonVariants.scaffoldingTier, owned.state.scaffoldingTier),
        isNull(lessonVariants.supersededAt),
      ),
    )
  if (!lesson) throw conflict('Open the bite before asking the tutor about it.', 'bite_not_started')
  const [exercise] = owned.state.selectedExerciseId
    ? await db.select().from(exerciseBankItems).where(eq(exerciseBankItems.id, owned.state.selectedExerciseId))
    : []

  const recent = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.userNodeStateId, biteId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(CHAT_HISTORY_CAP)
  const history = recent.reverse()
  while (history.length && history[0].role !== 'user') history.shift() // API turns must start with the learner

  const now = clock.now()
  await db.insert(chatMessages).values({ userNodeStateId: biteId, userId, role: 'user', content: input.message, createdAt: now })
  if (!owned.state.teachingCompletedAt) await touchSession(db, userId, now, 'new_content')

  return async (onText: (delta: string) => void, signal: AbortSignal) => {
    const reply = await deps.ai.streamTutor(
      {
        topicName: owned.topicName,
        nodeTitle: owned.node.title,
        objective: owned.node.objective,
        baseline: owned.progress.selfReportedBaseline,
        explanationMarkdown: lesson.explanationMarkdown,
        exerciseInstructions: exercise?.instructions ?? null,
        code: input.code ?? null,
        testOutput: input.testOutput ?? null,
        history,
        message: input.message,
      },
      { userId, onText, signal },
    )
    const [saved] = await db
      .insert(chatMessages)
      .values({ userNodeStateId: biteId, userId, role: 'assistant', content: reply, createdAt: new Date(clock.now().getTime() + 1) })
      .returning({ id: chatMessages.id })
    return saved.id
  }
}
