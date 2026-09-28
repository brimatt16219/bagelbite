/**
 * `[[Topic]]` / `[[Topic|label]]` wiki-links are captured server-side as topic relations; with the
 * topic-graph screen deferred they render as emphasis rather than dead links.
 */
export function renderWikiLinks(markdown: string): string {
  return markdown.replace(/\[\[([^[\]|\n]+)(?:\|([^[\]\n]+))?\]\]/g, (_m, name: string, label?: string) => `**${(label ?? name).trim()}**`)
}
