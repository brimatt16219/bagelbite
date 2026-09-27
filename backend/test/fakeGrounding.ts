import type { GroundingSource } from '../src/db/schema'
import { GroundingUnavailableError, type GroundingClient } from '../src/grounding/tavily'

/** Scripted grounding: returns canned sources, or throws when `fail` is set. */
export class FakeGrounding implements GroundingClient {
  enabled = true
  fail = false
  queries: string[] = []
  sources: GroundingSource[] = [
    { url: 'https://react.dev/reference/react/useEffect', title: 'useEffect – React', snippet: 'useEffect lets you synchronize a component with an external system.' },
    { url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript', title: 'JavaScript | MDN', snippet: 'JavaScript is a lightweight language.' },
  ]

  async search(query: string): Promise<GroundingSource[] | null> {
    this.queries.push(query)
    if (!this.enabled) return null
    if (this.fail) throw new GroundingUnavailableError('scripted failure')
    return this.sources
  }
}
