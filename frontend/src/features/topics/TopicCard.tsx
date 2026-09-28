import { Link } from 'react-router-dom'
import type { EnrollmentSummary } from '@shared/api'
import { Card } from '../../components/ui/Card'
import { ProgressBar } from '../../components/ui/ProgressBar'
import { StatusBadge } from '../../components/ui/StatusBadge'

/** One shared topic card for Home and the Progress dashboard (UI-Kit "Topic card"). */
export function TopicCard({ enrollment, size = 'thin' }: { enrollment: EnrollmentSummary; size?: 'thin' | 'thick' }) {
  const completed = enrollment.status === 'completed'
  return (
    <Card className="flex items-center gap-4">
      <div
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-accent/20 text-lg font-semibold text-accent-strong"
      >
        {enrollment.topicName.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate font-medium">{enrollment.topicName}</p>
          <StatusBadge status={completed ? 'mastered' : enrollment.startedCount ? 'in_progress' : 'available'} label={completed ? 'Mastered' : undefined} />
        </div>
        <ProgressBar
          className="mt-2"
          size={size}
          value={enrollment.percentComplete}
          tone={completed ? 'success' : 'accent'}
          label={`${enrollment.topicName}: ${enrollment.percentComplete}% mastered`}
        />
        <p className="mt-1.5 text-xs text-text-muted">
          {enrollment.masteredCount} of {enrollment.nodeCount} bites mastered
          {enrollment.dueReviewCount ? ` · ${enrollment.dueReviewCount} due for review` : ''}
        </p>
      </div>
      <Link
        to={`/topics/${enrollment.topicId}`}
        className="shrink-0 rounded-control bg-surface-muted px-4 py-2 text-sm font-medium hover:bg-accent/20"
      >
        {completed ? 'Review' : 'Resume'}
      </Link>
    </Card>
  )
}
