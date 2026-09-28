import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SendHorizontal } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { IconButton } from '../../components/ui/Button'
import { TextInput } from '../../components/ui/TextInput'
import { ErrorNotice, SkeletonLines } from '../../components/ui/feedback'
import { Markdown } from '../../components/Markdown'
import { ApiError } from '../../lib/api'
import { keys, useChatHistory } from '../../lib/queries'
import { streamChat } from '../../lib/sse'
import { cn } from '../../lib/cn'

interface Props {
  biteId: string
  /** Current editor code + latest test output, sent as tutor context. */
  getContext: () => { code?: string; testOutput?: string }
}

/** In-bite chat tutor (Design Screen 2 left panel, "Ask a question" mode). */
export function ChatPanel({ biteId, getContext }: Props) {
  const queryClient = useQueryClient()
  const history = useChatHistory(biteId)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<{ question: string; reply: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [history.data, pending])

  const send = async (e: FormEvent) => {
    e.preventDefault()
    const question = draft.trim()
    if (!question || pending) return
    setDraft('')
    setError(null)
    setPending({ question, reply: '' })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const { code, testOutput } = getContext()
      await streamChat(
        biteId,
        { message: question, code: code?.slice(0, 20_000), testOutput: testOutput?.slice(0, 8_000) },
        (event) => {
          if (event.type === 'delta') setPending((p) => (p ? { ...p, reply: p.reply + event.text } : p))
          if (event.type === 'error') setError(event.message)
        },
        controller.signal,
      )
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof ApiError ? err.message : "The tutor couldn't respond right now. Try again.")
    } finally {
      await queryClient.invalidateQueries({ queryKey: keys.chat(biteId) })
      setPending(null)
    }
  }

  const messages = history.data ?? []
  return (
    <div className="flex h-[calc(100vh-15rem)] min-h-[420px] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {history.isLoading ? <SkeletonLines lines={3} /> : null}
        {!history.isLoading && messages.length === 0 && !pending ? (
          <p className="text-sm text-text-muted">
            Ask anything about this bite — why something works, what a failing test means, or to go deeper on a section.
          </p>
        ) : null}
        {messages.map((m) => (
          <Bubble key={m.id} role={m.role} content={m.content} />
        ))}
        {pending ? (
          <>
            <Bubble role="user" content={pending.question} />
            <Bubble role="assistant" content={pending.reply || '…'} />
          </>
        ) : null}
        <div ref={endRef} />
      </div>
      {error ? <ErrorNotice message={error} className="mt-2" /> : null}
      <form onSubmit={send} className="mt-3 flex items-center gap-2">
        <TextInput
          aria-label="Ask the tutor"
          placeholder="Ask a question about this bite…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
        />
        {/* Disabled-but-visible when empty (UI-Kit), never hidden. */}
        <IconButton label="Send question" type="submit" disabled={!draft.trim() || Boolean(pending)} className="shrink-0 bg-accent text-text">
          <SendHorizontal className="h-4 w-4" aria-hidden />
        </IconButton>
      </form>
    </div>
  )
}

function Bubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  return (
    <div className={cn('max-w-[90%] rounded-card px-3 py-2 text-sm', role === 'user' ? 'ml-auto bg-accent/20' : 'bg-surface-muted')}>
      {role === 'assistant' ? <Markdown>{content}</Markdown> : <p className="whitespace-pre-wrap">{content}</p>}
    </div>
  )
}
