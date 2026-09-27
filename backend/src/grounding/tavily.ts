import type { GroundingSource } from '../db/schema'
import type { UsageRecorder } from '../ai/usage'

/**
 * Retrieval before generation for medium/high-risk nodes (Content-Accuracy §2).
 *
 * - Disabled client (local dev only): `search` returns null → content is marked not source-grounded.
 * - Enabled client: returns the (possibly empty) result list, or THROWS on a failed search. Lesson
 *   content is shared and cached forever, so a transient outage must fail the generation (the
 *   learner retries) instead of silently caching ungrounded content for every future learner.
 */
export interface GroundingClient {
  readonly enabled: boolean
  search(query: string, meta: { userId?: string }): Promise<GroundingSource[] | null>
}

export class GroundingUnavailableError extends Error {}

export class DisabledGroundingClient implements GroundingClient {
  readonly enabled = false
  async search(): Promise<null> {
    return null
  }
}

interface TavilyResult {
  title?: string
  url?: string
  content?: string
}

export class TavilyGroundingClient implements GroundingClient {
  readonly enabled = true

  constructor(
    private readonly apiKey: string,
    private readonly usage: UsageRecorder,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, meta: { userId?: string }): Promise<GroundingSource[]> {
    const started = performance.now()
    let sources: GroundingSource[]
    try {
      const res = await this.fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          // Bias toward official documentation (Content-Accuracy §2 "source trust").
          query: `${query} official documentation`,
          search_depth: 'basic',
          max_results: 5,
          include_answer: false,
        }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`)
      const body = (await res.json()) as { results?: TavilyResult[] }
      sources = (body.results ?? [])
        .filter((r): r is Required<TavilyResult> => Boolean(r.url && r.title && r.content))
        .map((r) => ({ url: r.url, title: r.title.slice(0, 200), snippet: r.content.slice(0, 1200) }))
    } catch (err) {
      await this.usage.record({
        callType: 'grounding_search',
        provider: 'tavily',
        model: 'tavily-basic',
        latencyMs: performance.now() - started,
        success: false,
        errorCode: err instanceof Error ? err.message.slice(0, 80) : 'unknown',
        userId: meta.userId,
      })
      throw new GroundingUnavailableError(err instanceof Error ? err.message : 'search failed')
    }
    await this.usage.record({
      callType: 'grounding_search',
      provider: 'tavily',
      model: 'tavily-basic',
      latencyMs: performance.now() - started,
      success: true,
      userId: meta.userId,
    })
    return sources
  }
}
