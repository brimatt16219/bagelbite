import { Link, useParams } from 'react-router-dom'
import { ArrowRight, Clock, Lock } from 'lucide-react'
import type { NextStep } from '@shared/api'
import { Card } from '../../components/ui/Card'
import { ProgressBar } from '../../components/ui/ProgressBar'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { ErrorNotice, SkeletonLines } from '../../components/ui/feedback'
import { ApiError } from '../../lib/api'
import { useEnrollment, useNextStep } from '../../lib/queries'
import { cn } from '../../lib/cn'

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function NextAction({ topicId, step }: { topicId: string; step: NextStep }) {
  const cta = 'inline-flex items-center gap-2 rounded-control bg-accent px-4 py-2 text-sm font-semibold hover:bg-accent-strong hover:text-white'
  switch (step.type) {
    case 'reviews':
      return (
        <Link to={`/reviews?topicId=${topicId}`} className={cta}>
          Review {step.dueCount} due {step.dueCount === 1 ? 'question' : 'questions'} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      )
    case 'bite':
      return (
        <Link to={`/topics/${topicId}/bites/${step.biteId}`} className={cta}>
          Continue: {step.title} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      )
    case 'waiting':
      return (
        <p className="flex items-start gap-2 text-sm text-text-muted">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {step.message}
            {step.nextReviewAt ? ` Next review: ${formatWhen(step.nextReviewAt)}.` : ''}
          </span>
        </p>
      )
    case 'completed':
      return <p className="text-sm font-medium text-success-strong">You've mastered every bite in this topic.</p>
  }
}

/** Curriculum view: progress, what to do next (session composer), and every bite's status. */
export default function TopicPage() {
  const { topicId = '' } = useParams()
  const enrollment = useEnrollment(topicId)
  const next = useNextStep(topicId, enrollment.isSuccess)

  if (enrollment.isPending) return <SkeletonLines lines={6} className="mx-auto mt-6 max-w-3xl" />
  if (enrollment.isError) {
    return (
      <ErrorNotice
        className="mx-auto mt-8 max-w-lg"
        message={enrollment.error instanceof ApiError && enrollment.error.status === 404 ? "You aren't enrolled in this topic." : "Couldn't load this topic. Try again."}
        action={<Link to="/" className="font-medium text-accent-strong underline">Go to home</Link>}
      />
    )
  }
  const e = enrollment.data
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <h1 className="text-2xl font-semibold">{e.topicName}</h1>
        {e.topicDescription ? <p className="mt-1 text-sm text-text-muted">{e.topicDescription}</p> : null}
        <ProgressBar className="mt-4" size="thick" value={e.percentComplete} tone={e.status === 'completed' ? 'success' : 'accent'} label={`${e.percentComplete}% mastered`} />
        <p className="mt-1.5 text-xs text-text-muted">
          {e.masteredCount} of {e.nodeCount} bites mastered · progress counts mastered bites only
        </p>
        <div className="mt-4">{next.data ? <NextAction topicId={topicId} step={next.data} /> : <SkeletonLines lines={1} className="w-48" />}</div>
      </Card>

      <section aria-labelledby="curriculum">
        <h2 id="curriculum" className="mb-3 text-lg font-semibold">
          Curriculum
        </h2>
        <ol className="space-y-2">
          {e.nodes.map((node) => {
            const locked = node.status === 'locked'
            const body = (
              <Card tone={locked ? 'suggested' : 'surface'} className={cn('flex items-start gap-4 py-4', !locked && 'transition-colors hover:bg-surface-muted')}>
                <span className="mt-0.5 w-6 shrink-0 text-sm text-text-muted">{node.orderIndex + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{node.title}</p>
                  <p className="text-sm text-text-muted">{node.objective}</p>
                  {locked && node.prerequisiteTitles.length ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                      <Lock className="h-3 w-3" aria-hidden /> Unlocks after mastering: {node.prerequisiteTitles.join(', ')}
                    </p>
                  ) : null}
                </div>
                <StatusBadge status={node.status} />
              </Card>
            )
            return (
              <li key={node.biteId}>
                {locked ? body : <Link to={`/topics/${topicId}/bites/${node.biteId}`} className="block rounded-card focus-visible:outline-2 focus-visible:outline-accent-strong">{body}</Link>}
              </li>
            )
          })}
        </ol>
      </section>

      {e.relatedTopics.length ? (
        <section aria-labelledby="related">
          <h2 id="related" className="mb-3 text-lg font-semibold">
            Related topics
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {e.relatedTopics.map((r) => (
              <Link key={r.topicId} to={`/?topic=${encodeURIComponent(r.name)}`} className="block">
                <Card tone="suggested" className="h-full transition-colors hover:bg-surface">
                  <p className="font-medium">{r.name}</p>
                  <p className="mt-1 text-xs text-text-muted">{r.reason}</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
