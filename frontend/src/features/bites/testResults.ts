/** Minimal structural types for Sandpack's test-run report (see SandpackTests `onComplete`). */
interface SandpackTest {
  name: string
  status: 'idle' | 'running' | 'pass' | 'fail'
  errors: { message?: string }[]
}
interface SandpackDescribe {
  name: string
  tests: Record<string, SandpackTest>
  describes: Record<string, SandpackDescribe>
}
export type SandpackSpec = SandpackDescribe & { error?: { message?: string } }

export interface TestSummary {
  passed: number
  total: number
  allPassed: boolean
  /** Short, plain-text description of failures — sent to the tutor as context. */
  output: string
}

function collect(block: SandpackDescribe, path: string[], out: { name: string; test: SandpackTest }[]) {
  for (const test of Object.values(block.tests ?? {})) out.push({ name: [...path, test.name].join(' > '), test })
  for (const child of Object.values(block.describes ?? {})) collect(child, [...path, child.name], out)
}

export function summarizeSpecs(specs: Record<string, SandpackSpec>): TestSummary {
  const tests: { name: string; test: SandpackTest }[] = []
  const lines: string[] = []
  for (const spec of Object.values(specs)) {
    if (spec.error) lines.push(`Test file failed to run: ${spec.error.message ?? 'unknown error'}`)
    collect(spec, [], tests)
  }
  const passed = tests.filter((t) => t.test.status === 'pass').length
  for (const t of tests.filter((t) => t.test.status === 'fail')) {
    lines.push(`FAIL ${t.name}: ${t.test.errors[0]?.message?.split('\n')[0] ?? ''}`.trim())
  }
  const hadFileError = Object.values(specs).some((s) => s.error)
  return {
    passed,
    total: tests.length,
    allPassed: !hadFileError && tests.length > 0 && passed === tests.length,
    output: lines.length ? lines.join('\n') : `All ${tests.length} tests passed.`,
  }
}
