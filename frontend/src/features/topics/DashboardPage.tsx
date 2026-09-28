import { Link } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { ErrorNotice, SkeletonLines } from '../../components/ui/feedback'
import { useDashboard } from '../../lib/queries'
import { TopicCard } from './TopicCard'

/** Screen 4 — plain, mastery-weighted progress list (Design.md). */
export default function DashboardPage() {
  const dashboard = useDashboard()
  if (dashboard.isPending) return <SkeletonLines lines={5} className="mx-auto mt-6 max-w-3xl" />
  if (dashboard.isError) return <ErrorNotice className="mx-auto mt-8 max-w-lg" message="Couldn't load your progress. Refresh to try again." />
  const d = dashboard.data
  const stats = [
    { label: 'Bites mastered', value: `${d.masteredTotal} / ${d.nodeTotal}` },
    { label: 'Topics', value: String(d.enrollments.length) },
    { label: 'Due for review', value: String(d.dueReviewCount) },
  ]
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Your progress</h1>
      <p className="mt-1 text-sm text-text-muted">A bite counts as mastered once you've recalled it correctly in two separate sessions.</p>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <Card key={s.label} className="py-4">
            <p className="text-xs text-text-muted">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold">{s.value}</p>
          </Card>
        ))}
      </div>
      {d.dueReviewCount ? (
        <Link to="/reviews" className="mt-4 inline-block text-sm font-medium text-accent-strong underline">
          Review {d.dueReviewCount} due {d.dueReviewCount === 1 ? 'question' : 'questions'}
        </Link>
      ) : null}
      <div className="mt-6 space-y-3">
        {d.enrollments.length ? (
          d.enrollments.map((e) => <TopicCard key={e.userTopicProgressId} enrollment={e} size="thick" />)
        ) : (
          <p className="text-sm text-text-muted">
            No topics yet. <Link to="/" className="font-medium text-accent-strong underline">Start one</Link>.
          </p>
        )}
      </div>
    </div>
  )
}
