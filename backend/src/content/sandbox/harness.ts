/**
 * Source of the minimal Jest-compatible test harness that runs inside the sandboxed child process.
 * Kept as a string so it can be passed with `node --eval` — the sandbox then needs no file-system
 * read permission at all. It supports exactly the API the exercise contract allows (see
 * EXERCISE_CONTRACT in ai/prompts.ts): describe/it/test, beforeEach/afterEach, and the listed
 * matchers. Input arrives on stdin as JSON {solution, tests}; a JSON report is written to stdout.
 */
export const HARNESS_SOURCE = String.raw`
const chunks = []
for await (const c of process.stdin) chunks.push(c)
const { solution, tests } = JSON.parse(Buffer.concat(chunks).toString('utf8'))

// Strip ambient capabilities the exercise contract doesn't allow.
for (const k of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'navigator']) {
  try { delete globalThis[k] } catch {}
}

const registered = []
const scope = [{ name: '', before: [], after: [] }]
globalThis.describe = (name, fn) => {
  scope.push({ name, before: [], after: [] })
  try { fn() } finally { scope.pop() }
}
const register = (name, fn) => registered.push({
  name: [...scope.map((s) => s.name).filter(Boolean), name].join(' > '),
  fn,
  before: scope.flatMap((s) => s.before),
  after: scope.flatMap((s) => s.after).reverse(),
})
globalThis.it = register
globalThis.test = register
globalThis.beforeEach = (fn) => scope[scope.length - 1].before.push(fn)
globalThis.afterEach = (fn) => scope[scope.length - 1].after.push(fn)

const fmt = (v) => { try { return JSON.stringify(v) } catch { return String(v) } }

function equal(a, b, strict) {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false
    for (const [k, v] of a) if (!b.has(k) || !equal(v, b.get(k), strict)) return false
    return true
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false
    for (const v of a) if (!b.has(v)) return false
    return true
  }
  const keys = (o) => Object.keys(o).filter((k) => strict || o[k] !== undefined)
  const ka = keys(a), kb = keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && equal(a[k], b[k], strict))
}

function getPath(obj, path) {
  const parts = Array.isArray(path) ? path : String(path).split('.')
  let cur = obj
  for (const p of parts) {
    if (cur === null || cur === undefined || !(p in Object(cur))) return { found: false }
    cur = cur[p]
  }
  return { found: true, value: cur }
}

function expect(actual) {
  const make = (negate) => {
    const check = (pass, message) => {
      if (negate ? pass : !pass) throw new Error((negate ? 'Expected not: ' : '') + message)
    }
    const m = {
      toBe: (e) => check(Object.is(actual, e), 'expected ' + fmt(actual) + ' to be ' + fmt(e)),
      toEqual: (e) => check(equal(actual, e, false), 'expected ' + fmt(actual) + ' to equal ' + fmt(e)),
      toStrictEqual: (e) => check(equal(actual, e, true), 'expected ' + fmt(actual) + ' to strictly equal ' + fmt(e)),
      toBeTruthy: () => check(Boolean(actual), 'expected ' + fmt(actual) + ' to be truthy'),
      toBeFalsy: () => check(!actual, 'expected ' + fmt(actual) + ' to be falsy'),
      toBeNull: () => check(actual === null, 'expected ' + fmt(actual) + ' to be null'),
      toBeUndefined: () => check(actual === undefined, 'expected ' + fmt(actual) + ' to be undefined'),
      toBeDefined: () => check(actual !== undefined, 'expected value to be defined'),
      toContain: (e) => check(
        (typeof actual === 'string' && actual.includes(e)) || (Array.isArray(actual) && actual.some((x) => Object.is(x, e))),
        'expected ' + fmt(actual) + ' to contain ' + fmt(e)),
      toHaveLength: (n) => check(actual != null && actual.length === n, 'expected length ' + n + ', got ' + (actual == null ? actual : actual.length)),
      toMatch: (re) => check(typeof actual === 'string' && (re instanceof RegExp ? re.test(actual) : actual.includes(re)), 'expected ' + fmt(actual) + ' to match ' + String(re)),
      toBeGreaterThan: (n) => check(actual > n, 'expected ' + fmt(actual) + ' > ' + n),
      toBeGreaterThanOrEqual: (n) => check(actual >= n, 'expected ' + fmt(actual) + ' >= ' + n),
      toBeLessThan: (n) => check(actual < n, 'expected ' + fmt(actual) + ' < ' + n),
      toBeLessThanOrEqual: (n) => check(actual <= n, 'expected ' + fmt(actual) + ' <= ' + n),
      toBeCloseTo: (n, digits = 2) => check(Math.abs(n - actual) < Math.pow(10, -digits) / 2, 'expected ' + fmt(actual) + ' to be close to ' + n),
      toHaveProperty: (path, ...value) => {
        const r = getPath(actual, path)
        check(r.found && (value.length === 0 || equal(r.value, value[0], false)), 'expected property ' + fmt(path))
      },
      toThrow: (expected) => {
        if (typeof actual !== 'function') throw new Error('toThrow needs a function')
        let threw = false, error
        try { actual() } catch (e) { threw = true; error = e }
        let ok = threw
        if (threw && expected !== undefined) {
          const msg = error && error.message !== undefined ? String(error.message) : String(error)
          if (typeof expected === 'string') ok = msg.includes(expected)
          else if (expected instanceof RegExp) ok = expected.test(msg)
          else if (typeof expected === 'function') ok = error instanceof expected
        }
        check(ok, 'expected function to throw' + (expected !== undefined ? ' ' + String(expected) : ''))
      },
    }
    return m
  }
  const api = make(false)
  api.not = make(true)
  return api
}
globalThis.expect = expect

const report = { total: 0, passed: 0, failures: [], loadError: null }
try {
  const solutionUrl = 'data:text/javascript;base64,' + Buffer.from(solution).toString('base64')
  const rewritten = tests.replace(/(['"])\.\/solution(\.js)?\1/g, JSON.stringify(solutionUrl))
  await import('data:text/javascript;base64,' + Buffer.from(rewritten).toString('base64'))
} catch (e) {
  report.loadError = String(e && e.message ? e.message : e).slice(0, 500)
}
for (const t of registered) {
  report.total++
  try {
    for (const h of t.before) await h()
    await t.fn()
    for (const h of t.after) await h()
    report.passed++
  } catch (e) {
    report.failures.push({ name: t.name, message: String(e && e.message ? e.message : e).slice(0, 300) })
  }
}
process.stdout.write(JSON.stringify(report))
`
