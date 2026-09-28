import { Fragment, useCallback, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, ChevronLeft, Info, Sparkles } from 'lucide-react'
import type { BiteDto } from '@shared/api'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { SegmentedToggle } from '../../components/ui/SegmentedToggle'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { ErrorNotice, SkeletonLines } from '../../components/ui/feedback'
import { Markdown } from '../../components/Markdown'
import { api, ApiError } from '../../lib/api'
import { useBite, useInvalidateProgress } from '../../lib/queries'
import { RetrievalPromptCard } from './RetrievalPromptCard'
import { CitationElement } from './CitationElement'
import { FlagButton } from './FlagButton'
import { ChatPanel } from './ChatPanel'
import { ExercisePanel } from './ExercisePanel'

type Panel = 'explanation' | 'chat'

export default function BitePage() {
  const { biteId = '', topicId = '' } = useParams()
  const bite = useBite(biteId)

  if (bite.isPending) return <BiteLoading />
  if (bite.isError) {
    const err = bite.error
    const locked = err instanceof ApiError && err.code === 'bite_locked'
    return (
      <div className="mx-auto mt-8 max-w-lg space-y-3">
        <ErrorNotice
          message={err instanceof ApiError ? err.message : "Couldn't load this bite. Try again."}
          action={
            locked ? (
              <Link className="font-medium text-accent-strong underline" to={`/topics/${topicId}`}>
                Back to the curriculum
              </Link>
            ) : (
              <Button size="sm" onClick={() => bite.refetch()}>
                Try again
              </Button>
            )
          }
        />
      </div>
    )
  }
  return <BiteView key={bite.data.id} bite={bite.data} />
}

function BiteLoading() {
  return (
    <div>
      <SkeletonLines lines={1} className="mb-6 w-64" />
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <p className="mb-4 flex items-center gap-2 text-sm text-text-muted">
            <Sparkles className="h-4 w-4 animate-pulse text-accent-strong" aria-hidden />
            Preparing this bite — the first time anyone opens it can take up to a minute.
          </p>
          <SkeletonLines lines={7} />
        </Card>
        <div className="h-[420px] animate-pulse rounded-card bg-code-bg" aria-hidden />
      </div>
    </div>
  )
}

function BiteView({ bite }: { bite: BiteDto }) {
  const navigate = useNavigate()
  const invalidate = useInvalidateProgress()
  const [panel, setPanel] = useState<Panel>('explanation')
  const [nextError, setNextError] = useState<string | null>(null)
  const context = useRef<{ code?: string; testOutput?: string }>({})
  const setContext = useCallback((c: { code: string; testOutput?: string }) => {
    context.current = c
  }, [])
  const getContext = useCallback(() => context.current, [])

  // Sections reveal progressively: a section appears once every question before it is rated.
  const ratedIds = new Set(bite.prompts.filter((p) => p.answered?.rating).map((p) => p.id))
  let visibleSections = 1
  for (let i = 1; i < bite.lesson.sections.length; i++) {
    const blocking = bite.prompts.filter((p) => p.afterSection < i)
    if (blocking.every((p) => ratedIds.has(p.id))) visibleSections = i + 1
    else break
  }
  const allSectionsVisible = visibleSections >= bite.lesson.sections.length

  const goNext = async () => {
    setNextError(null)
    try {
      const step = await api.next(bite.topicId)
      if (step.type === 'bite') navigate(`/topics/${bite.topicId}/bites/${step.biteId}`)
      else if (step.type === 'reviews') navigate(`/reviews?topicId=${bite.topicId}`)
      else navigate(`/topics/${bite.topicId}`)
    } catch {
      setNextError("Couldn't work out what's next. Try again.")
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={`/topics/${bite.topicId}`} className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
            <ChevronLeft className="h-4 w-4" aria-hidden /> {bite.topicName}
          </Link>
          <h1 className="text-2xl font-semibold">{bite.node.title}</h1>
          <p className="text-sm text-text-muted">
            Bite {bite.node.orderIndex + 1} of {bite.node.nodeCount} · {bite.node.objective}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {bite.scaffoldingTier === 'extra_scaffolding' ? (
            <span className="rounded-full bg-surface px-3 py-1 text-xs text-text-muted" title="Chosen from your recent answers">
              Extra support
            </span>
          ) : null}
          <StatusBadge status={bite.status} />
        </div>
      </div>

      {bite.contentSource === 'offline' ? (
        <ErrorNotice
          className="mb-4"
          message="Offline demo content: this bite was generated from a template because no AI provider is configured on the API. It is not a real lesson."
        />
      ) : null}

      <div className="grid grid-cols-2 gap-6">
        <Card className="min-w-0">
          <div className="mb-4 flex items-center justify-between">
            <SegmentedToggle<Panel>
              label="Left panel"
              value={panel}
              onChange={setPanel}
              options={[
                { value: 'explanation', label: 'Explanation' },
                { value: 'chat', label: 'Ask a question' },
              ]}
            />
            {panel === 'explanation' ? (
              <FlagButton biteId={bite.id} targetType="lesson_variant" targetId={bite.lesson.id} label="Report an issue with this explanation" />
            ) : null}
          </div>

          {panel === 'chat' ? (
            <ChatPanel biteId={bite.id} getContext={getContext} />
          ) : (
            <div className="space-y-5">
              {bite.node.prerequisiteTitles.length ? (
                <p className="text-xs text-text-muted">Builds on: {bite.node.prerequisiteTitles.join(', ')}</p>
              ) : null}
              {bite.lesson.sections.slice(0, visibleSections).map((section, i) => (
                <Fragment key={i}>
                  <Markdown>{section}</Markdown>
                  {bite.prompts
                    .filter((p) => p.afterSection === i)
                    .map((p) => (
                      <RetrievalPromptCard key={p.id} biteId={bite.id} prompt={p} answered={p.answered} onRated={() => invalidate(bite.id)} />
                    ))}
                </Fragment>
              ))}
              {!allSectionsVisible ? <p className="text-sm text-text-muted">Answer the question above to continue.</p> : null}

              {allSectionsVisible && bite.exercise ? (
                <div className="rounded-card bg-accent/10 p-4">
                  <p className="mb-1 text-sm font-semibold">Your task</p>
                  <Markdown>{bite.exercise.instructions}</Markdown>
                  <p className="text-xs text-text-muted">Write your solution in the editor, then run the tests.</p>
                </div>
              ) : null}

              {bite.lesson.verification === 'hedged' ? (
                <p className="flex items-start gap-1.5 text-xs text-text-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  Some specifics in this bite were softened after an accuracy review. Check the official docs before relying on them.
                </p>
              ) : null}
              <CitationElement citation={bite.lesson.citation} />

              {bite.teachingComplete ? (
                <div className="rounded-card bg-success/20 p-4">
                  <p className="font-medium">Bite complete</p>
                  <p className="mt-1 text-sm">
                    {bite.status === 'mastered'
                      ? 'Mastered — you have recalled it across spaced sessions.'
                      : "Its questions will come back for spaced review. It counts as mastered once you recall them again in a later session."}
                  </p>
                  <Button variant="primary" className="mt-3" icon={<ArrowRight className="h-4 w-4" aria-hidden />} onClick={goNext}>
                    What's next
                  </Button>
                  {nextError ? <ErrorNotice message={nextError} className="mt-2" /> : null}
                </div>
              ) : null}
            </div>
          )}
        </Card>

        <div className="min-w-0">
          {bite.exercise ? (
            <ExercisePanel bite={bite} onContext={setContext} />
          ) : (
            <Card tone="muted">
              <p className="text-sm text-text-muted">
                This bite has no coding exercise — the questions on the left are the practice. (Its generated exercise didn't pass our
                automatic checks, so it was left out rather than shown untested.)
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
