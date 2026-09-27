import { CheckCircle2, CircleDashed, CircleDot, Lock, PlusCircle } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '../../lib/cn'

export type Status = 'mastered' | 'in_progress' | 'available' | 'locked' | 'suggested'

const config: Record<Status, { label: string; icon: ComponentType<{ className?: string }>; className: string }> = {
  mastered: { label: 'Mastered', icon: CheckCircle2, className: 'text-success-strong' },
  in_progress: { label: 'In progress', icon: CircleDot, className: 'text-accent-strong' },
  available: { label: 'Ready', icon: CircleDashed, className: 'text-text' },
  locked: { label: 'Locked', icon: Lock, className: 'text-text-muted' },
  suggested: { label: 'Suggested', icon: PlusCircle, className: 'text-text-muted' },
}

/** Status is never signalled by color alone — every badge carries a distinct icon (UI-Kit). */
export function StatusBadge({ status, label, className }: { status: Status; label?: string; className?: string }) {
  const { label: defaultLabel, icon: Icon, className: tone } = config[status]
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', tone, className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label ?? defaultLabel}
    </span>
  )
}
