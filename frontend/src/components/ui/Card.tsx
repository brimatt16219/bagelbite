import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'surface' | 'muted' | 'suggested'
}

/** Borderless card: separation comes from fill contrast, not hairlines (Design.md). */
export function Card({ tone = 'surface', className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card p-5',
        tone === 'surface' && 'bg-surface',
        tone === 'muted' && 'bg-surface-muted',
        tone === 'suggested' && 'border border-dashed border-suggested-border bg-suggested-bg',
        className,
      )}
      {...rest}
    />
  )
}
