/**
 * FSRS scheduling via ts-fsrs (Architecture "Spaced repetition (FSRS)") — a pure function call,
 * never an LLM call. Short-term (same-day) learning steps are disabled: every rating schedules the
 * next review at least a day out, which is what makes two correct answers "separate spaced
 * sessions" for the mastery gate. With default parameters a first answer rated Again/Hard/Good/Easy
 * comes back after ~1/2/3/8 days.
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from 'ts-fsrs'
import type { ReviewRating } from '@shared/api'
import type { StoredFsrsCard } from '../db/schema'

const scheduler = fsrs(generatorParameters({ enable_short_term: false }))

const RATINGS: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
}

export function toStored(card: Card): StoredFsrsCard {
  const { due, last_review, ...rest } = card
  return { ...rest, due: due.toISOString(), last_review: last_review ? last_review.toISOString() : null }
}

export function fromStored(stored: StoredFsrsCard): Card {
  return { ...stored, due: new Date(stored.due), last_review: stored.last_review ? new Date(stored.last_review) : undefined }
}

export function newCard(now: Date): StoredFsrsCard {
  return toStored(createEmptyCard(now))
}

export function schedule(stored: StoredFsrsCard, now: Date, rating: ReviewRating): StoredFsrsCard {
  return toStored(scheduler.next(fromStored(stored), now, RATINGS[rating]).card)
}

/** Default self-rating to highlight after a reveal: wrong → again; right → from pre-reveal confidence. */
export function suggestedRating(correct: boolean, confidence: number): ReviewRating {
  if (!correct) return 'again'
  if (confidence >= 4) return 'easy'
  if (confidence === 3) return 'good'
  return 'hard'
}
