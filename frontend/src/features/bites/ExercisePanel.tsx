import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SandpackCodeEditor,
  SandpackLayout,
  SandpackProvider,
  SandpackTests,
  useSandpack,
  type SandpackThemeProp,
} from '@codesandbox/sandpack-react'
import { Eye } from 'lucide-react'
import type { BiteDto } from '@shared/api'
import { Button } from '../../components/ui/Button'
import { ErrorNotice } from '../../components/ui/feedback'
import { Markdown } from '../../components/Markdown'
import { api, ApiError } from '../../lib/api'
import { useInvalidateProgress } from '../../lib/queries'
import { summarizeSpecs, type SandpackSpec, type TestSummary } from './testResults'
import { FlagButton } from './FlagButton'

// Dark code surface — the one deliberate exception to the warm palette (Design.md).
const bagelCodeTheme: SandpackThemeProp = {
  colors: {
    surface1: '#16171a',
    surface2: '#1e1f23',
    surface3: '#2a2c31',
    clickable: '#a9a39b',
    base: '#e8e3dc',
    disabled: '#6b665f',
    hover: '#ffffff',
    accent: '#e39a5c',
    error: '#f0907f',
    errorSurface: '#3a2422',
  },
  syntax: {
    plain: '#e8e3dc',
    comment: { color: '#7d776f', fontStyle: 'italic' },
    keyword: '#e39a5c',
    definition: '#f2c38f',
    punctuation: '#a9a39b',
    property: '#a3c48a',
    tag: '#e39a5c',
    static: '#d9a0c8',
    string: '#a3c48a',
  },
  font: {
    body: 'Inter, ui-sans-serif, system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
    size: '13px',
    lineHeight: '20px',
  },
}

const codeKey = (exerciseId: string) => `bagelbite.code.${exerciseId}`

function loadCode(exerciseId: string, fallback: string): string {
  try {
    return localStorage.getItem(codeKey(exerciseId)) ?? fallback
  } catch {
    return fallback
  }
}

interface Props {
  bite: BiteDto
  /** Receives the learner's latest code and test output (tutor context). */
  onContext: (context: { code: string; testOutput?: string }) => void
}

/** Sandpack exercise (Design Screen 2 right panel). Tests run client-side; each run is an attempt. */
export function ExercisePanel({ bite, onContext }: Props) {
  const exercise = bite.exercise!
  const files = useMemo(
    () => ({
      '/solution.js': { code: loadCode(exercise.id, exercise.starterCode), active: true },
      '/solution.test.js': { code: exercise.testSpec, readOnly: true },
      '/package.json': { code: JSON.stringify({ main: '/solution.js', dependencies: {} }), hidden: true },
    }),
    // Re-create only when the exercise itself changes; later edits live inside Sandpack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercise.id],
  )

  return (
    <div className="overflow-hidden rounded-card bg-code-bg text-[#e8e3dc]">
      <div className="flex items-center justify-between px-4 pt-3">
        <p className="text-sm font-medium">Exercise</p>
        <FlagButton biteId={bite.id} targetType="exercise" targetId={exercise.id} label="Report an issue with this exercise" />
      </div>
      <SandpackProvider
        key={exercise.id}
        files={files}
        customSetup={{ environment: 'parcel', entry: '/solution.js' }}
        theme={bagelCodeTheme}
        options={{ activeFile: '/solution.js', visibleFiles: ['/solution.js', '/solution.test.js'] }}
      >
        <SandpackLayout style={{ border: 'none', borderRadius: 0 }}>
          <SandpackCodeEditor showTabs showLineNumbers style={{ height: 'calc(100vh - 26rem)', minHeight: 280 }} />
        </SandpackLayout>
        <ExerciseRunner bite={bite} onContext={onContext} />
      </SandpackProvider>
    </div>
  )
}

function ExerciseRunner({ bite, onContext }: Props) {
  const exercise = bite.exercise!
  const { sandpack } = useSandpack()
  const code = sandpack.files['/solution.js']?.code ?? ''
  const invalidate = useInvalidateProgress()
  const startedAt = useRef(0)
  const lastSummary = useRef<TestSummary | null>(null)
  const lastRecorded = useRef<string | null>(null)
  const [summary, setSummary] = useState<TestSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [solution, setSolution] = useState<string | null>(exercise.solutionCode)
  const [revealing, setRevealing] = useState(false)

  useEffect(() => {
    startedAt.current = Date.now()
  }, [])

  // Keep the learner's code across reloads (per-viewer convenience) and in the tutor's context.
  useEffect(() => {
    try {
      localStorage.setItem(codeKey(exercise.id), code)
    } catch {
      // storage unavailable
    }
    onContext({ code, testOutput: lastSummary.current?.output })
  }, [code, exercise.id, onContext])

  const recordRun = useCallback(
    async (specs: Record<string, SandpackSpec>) => {
      const result = summarizeSpecs(specs)
      lastSummary.current = result
      setSummary(result)
      onContext({ code, testOutput: result.output })
      setError(null)
      // Re-running unchanged code isn't a new attempt — don't inflate the retry count that feeds
      // the adaptive-difficulty signal.
      const fingerprint = `${code}\u0000${result.allPassed}`
      if (fingerprint === lastRecorded.current) return
      lastRecorded.current = fingerprint
      try {
        await api.attempt(bite.id, {
          code,
          passed: result.allPassed,
          testsPassed: result.passed,
          testsTotal: result.total,
          timeTakenMs: Math.min(Date.now() - startedAt.current, 24 * 60 * 60 * 1000),
        })
        invalidate(bite.id)
      } catch (err) {
        lastRecorded.current = null
        setError(err instanceof ApiError ? err.message : "Couldn't save that attempt. Run the tests again.")
      }
    },
    [bite.id, code, invalidate, onContext],
  )
  // SandpackTests calls onComplete from inside its own state updater (i.e. while rendering), so
  // our state updates must be deferred out of that render.
  const handleComplete = useCallback(
    (specs: Record<string, SandpackSpec>) => {
      window.setTimeout(() => void recordRun(specs), 0)
    },
    [recordRun],
  )

  const reveal = async () => {
    setRevealing(true)
    try {
      setSolution((await api.revealSolution(bite.id)).solutionCode)
      invalidate(bite.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reveal the solution. Try again.")
    } finally {
      setRevealing(false)
    }
  }

  const passed = summary ? summary.allPassed : bite.attempts.passed
  return (
    <div>
      <div className="max-h-56 overflow-y-auto">
        <SandpackTests onComplete={handleComplete} showWatchButton={false} showVerboseButton={false} watchMode={false} style={{ height: 'auto' }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3 text-sm">
        <span aria-live="polite">
          {summary
            ? `${summary.passed}/${summary.total} tests passing`
            : bite.attempts.passed
              ? 'Solved — all tests passing'
              : 'Run the tests to check your solution'}
          {bite.attempts.count ? <span className="text-[#a9a39b]"> · attempt {bite.attempts.count}</span> : null}
        </span>
        {bite.attempts.canRevealSolution && !solution ? (
          <Button size="sm" variant="secondary" icon={<Eye className="h-4 w-4" aria-hidden />} onClick={reveal} loading={revealing}>
            Reveal solution
          </Button>
        ) : null}
        {passed ? <span className="font-medium text-success">Passed</span> : null}
      </div>
      {error ? <ErrorNotice message={error} className="m-3 text-text" /> : null}
      {solution ? (
        <div className="border-t border-white/10 px-4 py-3">
          <p className="mb-2 text-sm font-medium">Worked solution</p>
          <Markdown className="[&_pre]:bg-code-surface [&_pre]:text-[#e8e3dc]">{'```js\n' + solution + '\n```'}</Markdown>
        </div>
      ) : null}
    </div>
  )
}
