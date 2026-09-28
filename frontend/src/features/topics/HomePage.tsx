import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { RotateCcw, Sparkles } from 'lucide-react'
import type { EnrollResponse, TopicCandidate } from '@shared/api'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { TextInput } from '../../components/ui/TextInput'
import { ErrorNotice, SkeletonLines } from '../../components/ui/feedback'
import { ApiError } from '../../lib/api'
import { useDashboard, useEnroll } from '../../lib/queries'
import { DisambiguationPicker } from './DisambiguationPicker'
import { TopicCard } from './TopicCard'

/** Screen 1 — start a topic and continue the ones in progress (Design.md). */
export default function HomePage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const dashboard = useDashboard()
  const enroll = useEnroll()
  const [topic, setTopic] = useState(params.get('topic') ?? '')
  const [baseline, setBaseline] = useState('')
  const [result, setResult] = useState<Exclude<EnrollResponse, { status: 'resolved' }> | null>(null)

  const start = async (topicText: string) => {
    setResult(null)
    try {
      const res = await enroll.mutateAsync({ topic: topicText, baseline })
      if (res.status === 'resolved') {
        // Flow 1 step 7: drop the learner straight into their first bite.
        navigate(res.firstBiteId && !res.alreadyEnrolled ? `/topics/${res.topicId}/bites/${res.firstBiteId}` : `/topics/${res.topicId}`)
      } else {
        setResult(res)
      }
    } catch {
      // surfaced below via enroll.error
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (topic.trim()) void start(topic.trim())
  }

  const pick = (candidate: TopicCandidate) => {
    setTopic(candidate.name)
    void start(candidate.name)
  }

  const enrollments = dashboard.data?.enrollments ?? []
  return (
    <div className="mx-auto max-w-3xl">
      <Card className="mt-2">
        <h1 className="text-2xl font-semibold">What do you want to learn?</h1>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <TextInput
            shape="pill"
            aria-label="Topic"
            placeholder="e.g. React, SQL joins, Rust ownership"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={120}
            autoFocus
          />
          <TextInput
            aria-label="What you already know"
            placeholder="What do you already know? e.g. I know JavaScript, new to React"
            value={baseline}
            onChange={(e) => setBaseline(e.target.value)}
            maxLength={300}
          />
          <Button type="submit" variant="primary" loading={enroll.isPending} disabled={!topic.trim()}>
            Start learning
          </Button>
        </form>

        {enroll.isPending ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-text-muted">
            <Sparkles className="h-4 w-4 animate-pulse text-accent-strong" aria-hidden />
            Designing your curriculum — a brand-new topic can take up to a minute.
          </p>
        ) : null}
        {enroll.isError ? (
          <ErrorNotice
            className="mt-3"
            message={enroll.error instanceof ApiError ? enroll.error.message : "Couldn't start that topic. Try again."}
          />
        ) : null}
        {result?.status === 'unsupported' ? <ErrorNotice className="mt-3" message={result.message} /> : null}
        {result?.status === 'disambiguate' ? (
          <DisambiguationPicker topic={topic} candidates={result.candidates} onPick={pick} disabled={enroll.isPending} />
        ) : null}
      </Card>

      {dashboard.data?.dueReviewCount ? (
        <Card tone="muted" className="mt-4 flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm">
            <RotateCcw className="h-4 w-4 text-accent-strong" aria-hidden />
            {dashboard.data.dueReviewCount} {dashboard.data.dueReviewCount === 1 ? 'question is' : 'questions are'} due for review.
          </p>
          <Link to="/reviews" className="rounded-control bg-accent px-4 py-2 text-sm font-semibold hover:bg-accent-strong hover:text-white">
            Start reviews
          </Link>
        </Card>
      ) : null}

      <section className="mt-8" aria-labelledby="your-topics">
        <h2 id="your-topics" className="mb-3 text-lg font-semibold">
          {enrollments.length ? 'Continue learning' : 'Start your first topic'}
        </h2>
        {dashboard.isLoading ? <SkeletonLines lines={3} /> : null}
        {dashboard.isError ? <ErrorNotice message="Couldn't load your topics. Refresh to try again." /> : null}
        {!dashboard.isLoading && !enrollments.length && !dashboard.isError ? (
          <p className="text-sm text-text-muted">
            Type a programming topic above. Bagelbite builds a short curriculum, teaches it in bites with questions you answer from
            memory, and brings those questions back on a spaced schedule until you've mastered them.
          </p>
        ) : null}
        <div className="space-y-3">
          {enrollments.map((e) => (
            <TopicCard key={e.userTopicProgressId} enrollment={e} />
          ))}
        </div>
      </section>
    </div>
  )
}
