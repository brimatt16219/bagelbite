import { useState, type FormEvent } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import type { AnsweredPromptDto, ConfidenceRating, PromptKind, ReviewRating } from '@shared/api'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { TextArea } from '../../components/ui/TextInput'
import { ErrorNotice } from '../../components/ui/feedback'
import { api, ApiError } from '../../lib/api'
import { cn } from '../../lib/cn'
import { FlagButton } from './FlagButton'

const kindLabel: Record<PromptKind, string> = {
  recall: 'Recall',
  explain_back: 'Explain it back',
  apply_scenario: 'Apply it',
}

const confidenceOptions: { value: ConfidenceRating; label: string }[] = [
  { value: 1, label: 'Guessing' },
  { value: 2, label: 'Unsure' },
  { value: 3, label: 'Fairly sure' },
  { value: 4, label: 'Certain' },
]

const ratingOptions: { value: ReviewRating; label: string; hint: string }[] = [
  { value: 'again', label: 'Again', hint: 'I did not really remember it' },
  { value: 'hard', label: 'Hard', hint: 'Remembered with real effort' },
  { value: 'good', label: 'Good', hint: 'Remembered after a moment' },
  { value: 'easy', label: 'Easy', hint: 'Knew it instantly' },
]

function suggested(correct: boolean, confidence: number): ReviewRating {
  if (!correct) return 'again'
  return confidence >= 4 ? 'easy' : confidence === 3 ? 'good' : 'hard'
}

interface Revealed {
  logId: string
  correct: boolean
  feedback: string
  answerKey: string
  suggestedRating: ReviewRating
  response: string
}

interface Props {
  biteId: string
  prompt: { id: string; kind: PromptKind; prompt: string }
  answered?: AnsweredPromptDto | null
  /** Called after the self-rating is saved. */
  onRated?: (result: { rating: ReviewRating; nextDueAt: string; nodeMastered: boolean }) => void
  label?: string
}

/**
 * One retrieval question (Pedagogy #1/#9/#10): write an answer from memory, rate confidence
 * BEFORE the reveal, see targeted feedback + the reference answer, then self-rate recall
 * (Again/Hard/Good/Easy) which schedules the next spaced review.
 */
export function RetrievalPromptCard({ biteId, prompt, answered, onRated, label }: Props) {
  const [response, setResponse] = useState('')
  const [confidence, setConfidence] = useState<ConfidenceRating | null>(null)
  const [revealed, setRevealed] = useState<Revealed | null>(
    answered && !answered.rating
      ? { ...answered, suggestedRating: suggested(answered.correct, answered.confidence) }
      : null,
  )
  const [rated, setRated] = useState<ReviewRating | null>(answered?.rating ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!response.trim() || !confidence) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.respond(biteId, prompt.id, { response, confidence })
      setRevealed({ ...result, response })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't grade that answer. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const rate = async (rating: ReviewRating) => {
    if (!revealed) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.rate(revealed.logId, rating)
      setRated(rating)
      onRated?.({ rating, nextDueAt: result.nextDueAt, nodeMastered: result.nodeMastered })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your rating. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const done = rated !== null
  const shownAnswer = revealed ?? (answered ? { ...answered, suggestedRating: answered.rating ?? 'good' } : null)

  return (
    <Card tone="muted" className="relative" aria-label={`${kindLabel[prompt.kind]} question`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-accent-strong">{label ?? kindLabel[prompt.kind]}</p>
        <FlagButton biteId={biteId} targetType="retrieval_prompt" targetId={prompt.id} label="Report an issue with this question" />
      </div>
      <p className="mt-1 font-medium">{prompt.prompt}</p>

      {!shownAnswer ? (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <TextArea
            aria-label="Your answer"
            rows={3}
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Answer from memory, in your own words…"
            maxLength={2000}
          />
          <fieldset>
            <legend className="text-sm text-text-muted">How sure are you?</legend>
            <div role="radiogroup" aria-label="Confidence" className="mt-1.5 flex flex-wrap gap-2">
              {confidenceOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={confidence === option.value}
                  onClick={() => setConfidence(option.value)}
                  className={cn(
                    'rounded-full px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent-strong',
                    confidence === option.value ? 'bg-accent/30 font-medium text-text' : 'bg-surface text-text-muted hover:text-text',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <Button type="submit" variant="primary" loading={busy} disabled={!response.trim() || !confidence}>
            Check my answer
          </Button>
        </form>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="rounded-control bg-surface px-3 py-2 text-sm">
            <p className="text-xs text-text-muted">Your answer</p>
            <p className="whitespace-pre-wrap">{shownAnswer.response}</p>
          </div>
          <div className="flex items-start gap-2 text-sm">
            {shownAnswer.correct ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-strong" aria-hidden />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
            )}
            <div>
              <p className="font-medium">{shownAnswer.correct ? 'Correct' : 'Not quite'}</p>
              <p>{shownAnswer.feedback}</p>
            </div>
          </div>
          <div className="rounded-control bg-surface px-3 py-2 text-sm">
            <p className="text-xs text-text-muted">Reference answer</p>
            <p>{shownAnswer.answerKey}</p>
          </div>

          {done ? (
            <p className="text-sm text-text-muted">
              Rated <span className="font-medium text-text">{rated}</span> — it will come back for spaced review.
            </p>
          ) : shownAnswer.correct ? (
            <div>
              <p className="text-sm text-text-muted">How well did you recall it?</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {ratingOptions.map((option) => (
                  <Button
                    key={option.value}
                    size="sm"
                    variant={option.value === shownAnswer.suggestedRating ? 'primary' : 'secondary'}
                    title={option.hint}
                    onClick={() => rate(option.value)}
                    disabled={busy}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <Button variant="primary" size="sm" onClick={() => rate('again')} loading={busy}>
              Continue
            </Button>
          )}
        </div>
      )}
      {error ? <ErrorNotice message={error} className="mt-3" /> : null}
    </Card>
  )
}
