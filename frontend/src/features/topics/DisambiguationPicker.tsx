import type { TopicCandidate } from '@shared/api'

interface Props {
  topic: string
  candidates: TopicCandidate[]
  onPick: (candidate: TopicCandidate) => void
  disabled?: boolean
}

/** Shown only when a broad umbrella topic needs a specific track first (Topic-Scoping.md). */
export function DisambiguationPicker({ topic, candidates, onPick, disabled }: Props) {
  return (
    <section aria-labelledby="disambiguation-heading" className="mt-4">
      <h2 id="disambiguation-heading" className="text-sm font-medium">
        "{topic}" covers several different tracks. Which one do you want?
      </h2>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {candidates.map((candidate) => (
          <button
            key={candidate.name}
            type="button"
            disabled={disabled}
            onClick={() => onPick(candidate)}
            className="rounded-card bg-surface p-4 text-left transition-colors hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-accent-strong disabled:opacity-50"
          >
            <p className="font-medium">{candidate.name}</p>
            <p className="mt-1 text-sm text-text-muted">{candidate.description}</p>
          </button>
        ))}
      </div>
    </section>
  )
}
