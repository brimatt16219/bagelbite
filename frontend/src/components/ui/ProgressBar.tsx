import { cn } from '../../lib/cn'

interface ProgressBarProps {
  value: number
  tone?: 'accent' | 'success'
  size?: 'thin' | 'thick'
  label: string
  className?: string
}

export function ProgressBar({ value, tone = 'accent', size = 'thin', label, className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn('w-full overflow-hidden rounded-full bg-surface-muted', size === 'thin' ? 'h-1' : 'h-1.5', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width]', tone === 'success' ? 'bg-success' : 'bg-accent')}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
