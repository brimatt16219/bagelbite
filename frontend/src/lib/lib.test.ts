import { describe, expect, it } from 'vitest'
import { parseSseChunk } from './sse'
import { renderWikiLinks } from './markdown'
import { summarizeSpecs, type SandpackSpec } from '../features/bites/testResults'

describe('parseSseChunk', () => {
  it('parses complete events and keeps the partial remainder', () => {
    const { events, rest } = parseSseChunk('data: {"type":"delta","text":"Hel"}\n\ndata: {"type":"delta","text":"lo"}\n\ndata: {"type":"do')
    expect(events).toEqual([
      { type: 'delta', text: 'Hel' },
      { type: 'delta', text: 'lo' },
    ])
    expect(rest).toBe('data: {"type":"do')
    expect(parseSseChunk(`${rest}ne","messageId":"m1"}\n\n`).events).toEqual([{ type: 'done', messageId: 'm1' }])
  })
})

describe('renderWikiLinks', () => {
  it('renders wiki-links as emphasis (graph screen is deferred)', () => {
    expect(renderWikiLinks('Try [[TypeScript]] or [[Node.js|Node]].')).toBe('Try **TypeScript** or **Node**.')
  })
})

describe('summarizeSpecs', () => {
  const test = (name: string, status: 'pass' | 'fail', message?: string) => ({ name, status, errors: message ? [{ message }] : [] })

  it('counts nested tests and describes failures for the tutor', () => {
    const specs: Record<string, SandpackSpec> = {
      '/solution.test.js': {
        name: '/solution.test.js',
        tests: {},
        describes: {
          clamp: {
            name: 'clamp',
            tests: { a: test('keeps values', 'pass'), b: test('raises low values', 'fail', 'expected -3 to be 0\n  at line 4') },
            describes: {},
          },
        },
      },
    }
    expect(summarizeSpecs(specs)).toEqual({
      passed: 1,
      total: 2,
      allPassed: false,
      output: 'FAIL clamp > raises low values: expected -3 to be 0',
    })
  })

  it('never reports a pass when the test file itself failed', () => {
    const summary = summarizeSpecs({ '/solution.test.js': { name: 'x', tests: {}, describes: {}, error: { message: 'SyntaxError' } } })
    expect(summary.allPassed).toBe(false)
    expect(summary.output).toMatch(/failed to run: SyntaxError/)
  })
})
