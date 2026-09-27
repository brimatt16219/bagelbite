/**
 * Server-side spec check for generated exercises (Architecture "Grading approach": a small shared
 * bank can be spec-checked once instead of trusted on every generation). Every exercise must:
 *   - import nothing except "./solution" in its tests, and nothing at all in solution/starter code;
 *   - have a solution that passes every test (at least 2 tests);
 *   - have starter code that fails at least one test.
 *
 * Only LLM-generated code runs here — never learner submissions (those run client-side in
 * Sandpack). The child process is locked down with the Node permission model (no file system,
 * child processes, workers or native addons), an empty environment, a memory cap and a hard
 * timeout. Residual risk: the permission model in Node 22 does not restrict network access; see
 * PROJECT_NOTES.md.
 */
import { spawn } from 'node:child_process'
import type { ExerciseDraft } from '../ai/types'
import { HARNESS_SOURCE } from './sandbox/harness'

export interface RunReport {
  total: number
  passed: number
  failures: { name: string; message: string }[]
  loadError: string | null
}

export type ValidationResult = { ok: true } | { ok: false; problem: string }

export interface ExerciseValidator {
  readonly enabled: boolean
  validate(exercise: Pick<ExerciseDraft, 'starterCode' | 'solutionCode' | 'testSpec'>): Promise<ValidationResult>
}

const TIMEOUT_MS = 5_000
const MAX_OUTPUT = 64 * 1024

export function runInSandbox(solution: string, tests: string): Promise<RunReport | { error: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--permission', '--max-old-space-size=64', '--input-type=module', '--eval', HARNESS_SOURCE],
      { env: {}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    )
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (value: RunReport | { error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ error: `timed out after ${TIMEOUT_MS / 1000}s (infinite loop?)` })
    }, TIMEOUT_MS)

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
      if (stdout.length > MAX_OUTPUT) {
        child.kill('SIGKILL')
        finish({ error: 'produced too much output' })
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString('utf8')
    })
    child.on('error', (err) => finish({ error: `sandbox failed to start: ${err.message}` }))
    child.on('close', () => {
      try {
        finish(JSON.parse(stdout) as RunReport)
      } catch {
        finish({ error: `sandbox crashed: ${stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300) || 'no output'}` })
      }
    })
    child.stdin.end(JSON.stringify({ solution, tests }))
  })
}

const IMPORT_RE = /(?:^|[\s;])import\s*(?:[\w*{}\s,]+\s*from\s*)?(['"])([^'"]+)\1/g
const DYNAMIC_RE = /\bimport\s*\(|\brequire\s*\(/

/** Static contract checks — cheap, and they reject most off-contract output before running anything. */
export function checkContract(ex: Pick<ExerciseDraft, 'starterCode' | 'solutionCode' | 'testSpec'>): string | null {
  for (const [label, code] of [
    ['starterCode', ex.starterCode],
    ['solutionCode', ex.solutionCode],
  ] as const) {
    if ([...code.matchAll(IMPORT_RE)].length || DYNAMIC_RE.test(code)) return `${label} must not import anything`
    if (!/\bexport\b/.test(code)) return `${label} has no named exports`
  }
  const specifiers = [...ex.testSpec.matchAll(IMPORT_RE)].map((m) => m[2])
  if (!specifiers.length) return 'testSpec does not import from "./solution"'
  const bad = specifiers.find((s) => s !== './solution' && s !== './solution.js')
  if (bad) return `testSpec may only import from "./solution" (found "${bad}")`
  if (DYNAMIC_RE.test(ex.testSpec)) return 'testSpec must not use dynamic import or require'
  return null
}

export class SandboxExerciseValidator implements ExerciseValidator {
  readonly enabled = true

  async validate(ex: Pick<ExerciseDraft, 'starterCode' | 'solutionCode' | 'testSpec'>): Promise<ValidationResult> {
    const contractProblem = checkContract(ex)
    if (contractProblem) return { ok: false, problem: contractProblem }

    const [solutionRun, starterRun] = await Promise.all([
      runInSandbox(ex.solutionCode, ex.testSpec),
      runInSandbox(ex.starterCode, ex.testSpec),
    ])
    if ('error' in solutionRun) return { ok: false, problem: `solution run ${solutionRun.error}` }
    if (solutionRun.loadError) return { ok: false, problem: `solution or tests failed to load: ${solutionRun.loadError}` }
    if (solutionRun.total < 2) return { ok: false, problem: `only ${solutionRun.total} test(s); need at least 2` }
    if (solutionRun.passed !== solutionRun.total) {
      const f = solutionRun.failures[0]
      return { ok: false, problem: `solution fails test "${f?.name}": ${f?.message}` }
    }
    if ('error' in starterRun) {
      // A starter that loops/crashes still "fails", but that's a bad learner experience.
      return { ok: false, problem: `starter code run ${starterRun.error}` }
    }
    if (starterRun.loadError) return { ok: false, problem: `starter code failed to load: ${starterRun.loadError}` }
    if (starterRun.passed === starterRun.total) {
      return { ok: false, problem: 'starter code already passes every test' }
    }
    return { ok: true }
  }
}

/** EXERCISE_VALIDATION=false (local dev only; refused in production by config). */
export class SkipExerciseValidator implements ExerciseValidator {
  readonly enabled = false
  async validate(): Promise<ValidationResult> {
    return { ok: true }
  }
}
