/**
 * `[[Topic Name]]` references inside lesson markdown (Architecture "How edges get created") —
 * mirrors Obsidian's own link indexing. Parsed server-side into TopicRelation edges; rendered as
 * plain emphasis in v1 since the graph screen is deferred.
 */
const WIKI_LINK = /\[\[([^[\]|\n]{2,80})(?:\|[^[\]\n]*)?\]\]/g

export function extractWikiLinks(markdown: string): string[] {
  const seen = new Map<string, string>()
  for (const match of markdown.matchAll(WIKI_LINK)) {
    const name = match[1].trim()
    const key = name.toLowerCase()
    if (name && !seen.has(key)) seen.set(key, name)
  }
  return [...seen.values()].slice(0, 5)
}
