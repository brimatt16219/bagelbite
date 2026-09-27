/**
 * Topic-name normalization for deduplication (Architecture "Topic resolution / deduplication").
 * Deliberately simple: case, whitespace, punctuation and the common ".js"/"js" suffix. Anything
 * subtler ("React" vs "React.js" typed some other way) is handed to the scoping call as a list of
 * similar existing topics, so the model can say "this is topic X" without a separate call.
 */
export function normalizeTopicName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/c#/g, 'csharp')
    .replace(/c\+\+/g, 'cpp')
    .replace(/[._\-/]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ ?js$/, '')
    .trim()
}

/** Candidate similar topics: names sharing a significant word with the request. */
export function significantWords(name: string): string[] {
  const stop = new Set(['the', 'and', 'for', 'with', 'how', 'to', 'in', 'of', 'a', 'an', 'basics', 'intro', 'introduction', 'learn', 'learning'])
  return [...new Set(normalizeTopicName(name).split(' ').filter((w) => w.length >= 2 && !stop.has(w)))]
}
