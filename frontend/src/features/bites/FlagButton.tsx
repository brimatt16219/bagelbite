import { useState, type FormEvent } from 'react'
import { Flag } from 'lucide-react'
import type { FlagTargetType } from '@shared/api'
import { Button, IconButton } from '../../components/ui/Button'
import { TextArea } from '../../components/ui/TextInput'
import { useToast } from '../../components/ui/toast-context'
import { api } from '../../lib/api'

interface Props {
  biteId: string
  targetType: FlagTargetType
  targetId: string
  label: string
}

/**
 * "Report an issue" on a single content block (UI-Kit). Opens an optional reason field instead of
 * firing immediately; the UI is identical regardless of risk tier (suppression is a backend concern).
 */
export function FlagButton({ biteId, targetType, targetId, label }: Props) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.flag(biteId, { targetType, targetId, reason: reason.trim() || undefined })
      toast.show("Thanks, we'll look into it")
      setOpen(false)
      setReason('')
    } catch {
      toast.show("Couldn't send your report. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <IconButton label={label} onClick={() => setOpen((v) => !v)} aria-expanded={open} className="h-7 w-7 bg-transparent">
        <Flag className="h-3.5 w-3.5" aria-hidden />
      </IconButton>
      {open ? (
        <form
          onSubmit={submit}
          className="absolute right-0 z-20 mt-1 w-72 space-y-2 rounded-card bg-surface p-3 text-left shadow-lg"
          aria-label={label}
        >
          <p className="text-sm font-medium">Report an issue</p>
          <TextArea
            rows={3}
            aria-label="What's wrong? (optional)"
            placeholder="What's wrong? (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" variant="primary" loading={busy}>
              Send report
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
