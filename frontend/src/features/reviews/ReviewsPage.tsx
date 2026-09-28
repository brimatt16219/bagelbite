import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import type { DueReviewDto } from '@shared/api'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ErrorNotice, SkeletonLines } from '../../components/ui/feedback'
import { useDueReviews, useInvalidateProgress } from '../../lib/queries'
import { RetrievalPromptCard } from '../bites/RetrievalPromptCard'

/**
 * Spaced-review session (Product-Spec flow 3): due questions one at a time, each answered from
 * memory with a confidence rating, then self-rated to reschedule it.
 */
export default function ReviewsPage() {
  const [params] = useSearchParams()
  const topicId = params.get('topicId') ?? undefined
  const due = useDueReviews(topicId)
  const invalidate = useInvalidateProgress()
  // Snapshot the queue when the session starts so rated items don't reshuffle it mid-session.
  const [queue, setQueue] = useState<DueReviewDto[] | null>(null)
  const [index, setIndex] = useState(0)
  const [rated, setRated] = useState(false)
  const [mastered, setMastered] = useState(0)

  if (due.isPending) return <SkeletonLines lines={4} className="mx-auto mt-6 max-w-2xl" />
  if (due.isError) return <ErrorNotice className="mx-auto mt-8 max-w-lg" message="Couldn't load your reviews. Refresh to try again." />

  const items = queue ?? due.data.reviews
  if (!queue && items.length) setQueue(items)
  const current = items[index]
  const finished = index >= items.length

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Reviews</h1>
      <p className="mt-1 text-sm text-text-muted">
        Recall each answer from memory before you check it — the effort of retrieving is what makes it stick.
      </p>

      {finished ? (
        <Card className="mt-6 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-success-strong" aria-hidden />
          <p className="mt-2 font-medium">{items.length ? 'All caught up' : 'Nothing is due right now'}</p>
          <p className="mt-1 text-sm text-text-muted">
            {items.length
              ? `You reviewed ${items.length} ${items.length === 1 ? 'question' : 'questions'}${mastered ? ` and mastered ${mastered} ${mastered === 1 ? 'bite' : 'bites'}` : ''}. Each one is scheduled to come back when you're about to forget it.`
              : 'Questions come back here on a spaced schedule after you answer them in a bite.'}
          </p>
          <Link to={topicId ? `/topics/${topicId}` : '/'} className="mt-4 inline-block text-sm font-medium text-accent-strong underline">
            {topicId ? 'Back to the topic' : 'Back to your topics'}
          </Link>
        </Card>
      ) : (
        <div className="mt-6 space-y-3">
          <p className="text-sm text-text-muted">
            {index + 1} of {items.length} · {current.topicName} — {current.nodeTitle}
          </p>
          <RetrievalPromptCard
            key={current.reviewItemId}
            biteId={current.biteId}
            prompt={{ id: current.promptId, kind: current.kind, prompt: current.prompt }}
            onRated={(result) => {
              setRated(true)
              if (result.nodeMastered) setMastered((n) => n + 1)
              invalidate(current.biteId)
            }}
          />
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={!rated}
              onClick={() => {
                setRated(false)
                setIndex((i) => i + 1)
              }}
            >
              {index + 1 < items.length ? 'Next question' : 'Finish'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
