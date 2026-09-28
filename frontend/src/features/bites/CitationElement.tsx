import { BookOpen, ExternalLink } from 'lucide-react'
import type { CitationDto } from '@shared/api'

/**
 * Source transparency (Content-Accuracy §5, UI-Kit): real links only when the content was grounded;
 * otherwise a plain marker in the same position. Never a fabricated citation.
 */
export function CitationElement({ citation }: { citation: CitationDto }) {
  if (citation.kind === 'grounded') {
    return (
      <div className="text-xs text-text-muted">
        <p className="mb-1 flex items-center gap-1 font-medium">
          <BookOpen className="h-3.5 w-3.5" aria-hidden /> Sources
        </p>
        <ul className="space-y-0.5">
          {citation.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-text">
                {s.title} <span className="opacity-70">· {s.domain}</span>
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <p className="flex items-center gap-1 text-xs text-text-muted">
      <BookOpen className="h-3.5 w-3.5" aria-hidden />
      {citation.reason === 'low_risk'
        ? 'General knowledge, not source-grounded'
        : 'Not source-grounded (source checks were unavailable when this was written)'}
    </p>
  )
}
