import type { ApiErrorBody, ChatRequest, ChatStreamEvent } from '@shared/api'
import { ApiError, authHeaders } from './api'
import { env } from './env'

/** Splits a server-sent-events buffer into complete `data:` payloads, returning the unparsed rest. */
export function parseSseChunk(buffer: string): { events: ChatStreamEvent[]; rest: string } {
  const events: ChatStreamEvent[] = []
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) continue
    try {
      events.push(JSON.parse(data) as ChatStreamEvent)
    } catch {
      // ignore malformed event
    }
  }
  return { events, rest }
}

/**
 * POST /bites/:id/chat and stream the reply. EventSource can't send a POST body or an
 * Authorization header, so this reads the SSE stream from fetch directly.
 */
export async function streamChat(
  biteId: string,
  body: ChatRequest,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${env.apiUrl}/bites/${biteId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    let err: ApiErrorBody | null = null
    try {
      err = (await res.json()) as ApiErrorBody
    } catch {
      // non-JSON
    }
    throw new ApiError(res.status, err?.error.code ?? 'http_error', err?.error.message ?? "The tutor couldn't respond right now. Try again.")
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const parsed = parseSseChunk(buffer + value)
    buffer = parsed.rest
    parsed.events.forEach(onEvent)
  }
  parseSseChunk(`${buffer}\n\n`).events.forEach(onEvent)
}
