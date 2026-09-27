import { cn } from '../../lib/cn'

interface Option<T extends string> {
  value: T
  label: string
}

interface SegmentedToggleProps<T extends string> {
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}

export function SegmentedToggle<T extends string>({ options, value, onChange, label }: SegmentedToggleProps<T>) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-1 rounded-full bg-surface-muted p-1">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-full px-3 py-1 text-sm transition-colors',
              'focus-visible:outline-2 focus-visible:outline-accent-strong',
              active ? 'bg-accent/25 font-medium text-text' : 'text-text-muted hover:text-text',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
