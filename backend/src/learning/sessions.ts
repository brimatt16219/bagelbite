/**
 * Learning sessions, tracked server-side (MVP-Synthesis §4 "session start/end, tagged new-content
 * vs review-only"). A session is a run of activity with no gap longer than 30 minutes. Sessions
 * also define "separate spaced sessions" for the mastery gate (PROJECT_NOTES §2.9).
 */
import { and, desc, eq, gte } from 'drizzle-orm'
import type { Db } from '../db/client'
import { learningSessions } from '../db/schema'

export const SESSION_GAP_MS = 30 * 60 * 1000

export async function touchSession(db: Db, userId: string, now: Date, kind: 'new_content' | 'review'): Promise<string> {
  const flag = kind === 'new_content' ? { hadNewContent: true } : { hadReview: true }
  const [open] = await db
    .select({ id: learningSessions.id })
    .from(learningSessions)
    .where(and(eq(learningSessions.userId, userId), gte(learningSessions.lastActivityAt, new Date(now.getTime() - SESSION_GAP_MS))))
    .orderBy(desc(learningSessions.lastActivityAt))
    .limit(1)
  if (open) {
    await db.update(learningSessions).set({ lastActivityAt: now, ...flag }).where(eq(learningSessions.id, open.id))
    return open.id
  }
  const [created] = await db
    .insert(learningSessions)
    .values({ userId, startedAt: now, lastActivityAt: now, ...flag })
    .returning({ id: learningSessions.id })
  return created.id
}
