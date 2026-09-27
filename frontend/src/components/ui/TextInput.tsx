import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Pill shape is reserved for the signature "what do you want to learn" entry (UI-Kit). */
  shape?: 'default' | 'pill'
}

const base =
  'w-full border border-input-border bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-muted ' +
  'focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60'

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { shape = 'default', className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(base, shape === 'pill' ? 'rounded-full' : 'rounded-input', className)} {...rest} />
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(base, 'rounded-input leading-relaxed', className)} {...rest} />
})
