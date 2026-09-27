import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '../../lib/cn'

/** Skeleton text blocks — keeps layout stable while generation is in flight (UI-Kit loading states). */
export function SkeletonLines({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2.5', className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-3.5 animate-pulse rounded bg-surface-muted"
          style={{ width: `${i === lines - 1 ? 60 : 92 - (i % 3) * 8}%` }}
        />
      ))}
    </div>
  )
}

/** Error copy convention: say what happened, then what to do. No raw exception text. */
export function ErrorNotice({ message, action, className }: { message: string; action?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn('flex items-start gap-2 rounded-control bg-surface-muted px-4 py-3 text-sm', className)}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
      <div className="flex-1">
        <p>{message}</p>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  )
}
