/**
 * Keyless local-development AI (LLM_PROVIDER=offline; refused in production by config).
 * Returns deterministic TEMPLATE content so the whole app can be exercised without an Anthropic
 * key. Everything it produces is stored with contentSource='offline' and the UI shows an
 * "offline demo content" banner — it is never presented as real AI-generated teaching content.
 */
import type {
  AiService,
  ExerciseDraft,
  ExerciseRepairInput,
  GradeInput,
  GradeResult,
  HedgeInput,
  LessonDraft,
  LessonInput,
  ScopeInput,
  ScopeResult,
  TutorInput,
  VerifyInput,
  VerifyResult,
} from './types'
import { normalizeTopicName } from '../content/topicNames'

const UMBRELLAS = new Set(['net', 'dotnet', 'web development', 'web dev', 'python', 'javascript', 'game development', 'programming', 'coding'])
const OUT_OF_SCOPE = /\b(cook|cooking|recipe|medical|medicine|diagnos\w*|tax|taxes|legal|lawsuit|invest\w*|stocks?|diet|fitness)\b/i
const SECURITY = /\b(auth\w*|security|crypto\w*|password\w*|jwt|oauth|injection|xss|csrf)\b/i

const OFFLINE_NOTE =
  '> Offline demo content: this bite was generated from a template because no AI provider is configured. It exists so the app can be run locally; it is not a real lesson.'

const EXERCISES: Array<Omit<ExerciseDraft, 'suitableTiers'>> = [
  {
    instructions: 'Implement `clamp(value, min, max)` so it returns `value` limited to the inclusive range `[min, max]`.',
    starterCode: `// Return value limited to the inclusive range [min, max].\nexport function clamp(value, min, max) {\n  throw new Error('Not implemented')\n}\n`,
    solutionCode: `export function clamp(value, min, max) {\n  return Math.min(Math.max(value, min), max)\n}\n`,
    testSpec: `import { clamp } from "./solution"\n\ndescribe("clamp", () => {\n  it("returns values inside the range unchanged", () => {\n    expect(clamp(5, 0, 10)).toBe(5)\n  })\n  it("raises values below the minimum", () => {\n    expect(clamp(-3, 0, 10)).toBe(0)\n  })\n  it("lowers values above the maximum", () => {\n    expect(clamp(42, 0, 10)).toBe(10)\n  })\n})\n`,
  },
  {
    instructions:
      'Implement `groupBy(items, keyFn)` returning an object that maps each key produced by `keyFn(item)` to the array of items with that key, preserving input order.',
    starterCode: `// Group items into { [key]: item[] } using keyFn(item) as the key.\nexport function groupBy(items, keyFn) {\n  throw new Error('Not implemented')\n}\n`,
    solutionCode: `export function groupBy(items, keyFn) {\n  const groups = {}\n  for (const item of items) {\n    const key = keyFn(item)\n    if (!groups[key]) groups[key] = []\n    groups[key].push(item)\n  }\n  return groups\n}\n`,
    testSpec: `import { groupBy } from "./solution"\n\ndescribe("groupBy", () => {\n  it("groups by the computed key", () => {\n    expect(groupBy([1, 2, 3, 4], (n) => (n % 2 ? "odd" : "even"))).toEqual({ odd: [1, 3], even: [2, 4] })\n  })\n  it("returns an empty object for no items", () => {\n    expect(groupBy([], (x) => x)).toEqual({})\n  })\n  it("keeps input order inside each group", () => {\n    expect(groupBy(["bb", "a", "cc"], (s) => s.length)).toEqual({ 1: ["a"], 2: ["bb", "cc"] })\n  })\n})\n`,
  },
  {
    instructions: 'Implement `chunk(array, size)` that splits `array` into consecutive chunks of length `size` (the last chunk may be shorter). Throw if `size` is less than 1.',
    starterCode: `// Split array into chunks of the given size.\nexport function chunk(array, size) {\n  throw new Error('Not implemented')\n}\n`,
    solutionCode: `export function chunk(array, size) {\n  if (size < 1) throw new Error('size must be at least 1')\n  const out = []\n  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size))\n  return out\n}\n`,
    testSpec: `import { chunk } from "./solution"\n\ndescribe("chunk", () => {\n  it("splits evenly", () => {\n    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])\n  })\n  it("keeps a shorter final chunk", () => {\n    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]])\n  })\n  it("rejects sizes below 1", () => {\n    expect(() => chunk([1], 0)).toThrow()\n  })\n})\n`,
  },
  {
    instructions: 'Implement `dedupe(items)` returning a new array with duplicates removed, keeping the first occurrence of each value in its original position.',
    starterCode: `// Remove duplicates, keeping first occurrences in order.\nexport function dedupe(items) {\n  throw new Error('Not implemented')\n}\n`,
    solutionCode: `export function dedupe(items) {\n  return [...new Set(items)]\n}\n`,
    testSpec: `import { dedupe } from "./solution"\n\ndescribe("dedupe", () => {\n  it("removes repeated values", () => {\n    expect(dedupe([1, 1, 2, 3, 3])).toEqual([1, 2, 3])\n  })\n  it("keeps first-occurrence order", () => {\n    expect(dedupe(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"])\n  })\n  it("does not mutate the input", () => {\n    const input = [1, 1]\n    dedupe(input)\n    expect(input).toHaveLength(2)\n  })\n})\n`,
  },
]

function hash(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

export class OfflineAiService implements AiService {
  readonly source: 'offline' | 'fake' = 'offline'

  async scope(input: ScopeInput): Promise<ScopeResult> {
    const topic = input.topic.trim()
    const normalized = normalizeTopicName(topic)
    if (OUT_OF_SCOPE.test(topic)) {
      return { status: 'unsupported', message: 'Bagelbite covers programming and tech topics. Try a programming topic instead.' }
    }
    if (UMBRELLAS.has(normalized) && input.baseline.trim().length < 25) {
      const name = normalized === 'net' || normalized === 'dotnet' ? 'C# & .NET' : titleCase(topic)
      return {
        status: 'disambiguate',
        candidates: [
          { name: `${name} fundamentals`, description: 'Core language and runtime concepts.' },
          { name: `${name} web APIs`, description: 'Building HTTP backends.' },
          { name: `${name} testing`, description: 'Writing and structuring automated tests.' },
        ],
      }
    }
    const matched = input.similarTopics.find((t) => normalizeTopicName(t.name) === normalized)
    const name = matched?.name ?? titleCase(topic)
    const security = SECURITY.test(topic)
    const titles = [
      `What ${name} is for`,
      `Core building blocks`,
      `Everyday ${name} patterns`,
      `Version-specific details`,
      security ? `Doing ${name} securely` : `Common pitfalls`,
      `Putting it together`,
    ]
    const scaffolds = [[], [], [0], [1], [2, 3], [4]]
    return {
      status: 'resolved',
      matchedExistingTopicId: matched?.id ?? null,
      topicName: name,
      topicDescription: `Offline demo curriculum for ${name}.`,
      nodes: titles.map((title, i) => ({
        title,
        objective: `Explain and apply the key ideas of "${title.toLowerCase()}" in ${name}.`,
        riskTier: i === 3 ? 'medium' : i === 4 && security ? 'high' : 'low',
        scaffoldsOn: scaffolds[i],
      })),
      relatedTopics: [
        { name: `${name} testing`, description: `Testing ${name} code.`, relationType: 'deepens', reason: `Testing builds directly on writing ${name}.` },
        { name: `Debugging ${name}`, description: `Finding bugs in ${name}.`, relationType: 'related', reason: 'Debugging is used alongside every topic.' },
      ],
    }
  }

  async generateLesson(input: LessonInput): Promise<LessonDraft> {
    const extra = input.tier === 'extra_scaffolding'
    const sections = [
      `## The idea behind ${input.nodeTitle.toLowerCase()}\n\n${OFFLINE_NOTE}\n\nObjective for this bite: ${input.objective}${extra ? '\n\nWe will take this one small step at a time.' : ''}`,
      `## How it looks in practice\n\nA concrete example in ${input.topicName} would appear here, with a short code snippet:\n\n\`\`\`js\nconst example = 'offline placeholder'\n\`\`\``,
      `## Where it goes wrong\n\nThis section would cover a common mistake with ${input.nodeTitle.toLowerCase()}${input.riskTier === 'high' ? ', plus a caveat that this is a simplified learning example and production use needs a vetted library and a security review' : ''}.`,
    ]
    const key = `The main idea is to ${input.objective.replace(/\.$/, '').toLowerCase()}.`
    const misconceptions = [{ wrongPattern: "I don't know / no attempt", correction: 'Have a go from memory first — retrieving an answer, even a partial one, is what makes it stick.' }]
    const both: Array<'standard' | 'extra_scaffolding'> = ['standard', 'extra_scaffolding']
    const start = hash(input.nodeTitle) % EXERCISES.length
    return {
      explanationMarkdown: sections.join('\n\n'),
      claims: input.grounding?.length ? [{ claim: `Background for ${input.nodeTitle}.`, supportingSourceIndex: 0 }] : [],
      prompts: [
        { prompt: `In your own words, what is the main idea of "${input.nodeTitle}"?`, kind: 'explain_back', answerKey: key, suitableTiers: both, anticipatedMisconceptions: misconceptions },
        { prompt: `What does this bite's objective ask you to be able to do?`, kind: 'recall', answerKey: key, suitableTiers: both, anticipatedMisconceptions: misconceptions },
        { prompt: `Describe a situation where you would use what "${input.nodeTitle}" teaches.`, kind: 'apply_scenario', answerKey: key, suitableTiers: both, anticipatedMisconceptions: misconceptions },
        { prompt: `What is one common mistake related to "${input.nodeTitle}"?`, kind: 'recall', answerKey: key, suitableTiers: both, anticipatedMisconceptions: misconceptions },
        { prompt: `Explain "${input.nodeTitle}" to a teammate in two sentences.`, kind: 'explain_back', answerKey: key, suitableTiers: both, anticipatedMisconceptions: misconceptions },
      ],
      exercises: [0, 1].map((offset) => ({ ...EXERCISES[(start + offset) % EXERCISES.length], suitableTiers: both })),
    }
  }

  async repairExercises(input: ExerciseRepairInput): Promise<ExerciseDraft[]> {
    return input.failures.map((_, i) => ({ ...EXERCISES[i % EXERCISES.length], suitableTiers: ['standard', 'extra_scaffolding'] }))
  }

  async verifyLesson(_input?: VerifyInput): Promise<VerifyResult> {
    return { passed: true, concerns: [] }
  }

  async hedgeLesson(input: HedgeInput): Promise<{ explanationMarkdown: string }> {
    return { explanationMarkdown: input.explanationMarkdown }
  }

  /** Crude keyword-overlap grader — good enough to click through the flow offline. */
  async grade(input: GradeInput): Promise<GradeResult> {
    const answer = input.response.trim().toLowerCase()
    if (!answer || /^(i don'?t know|idk|no idea|\?+)$/.test(answer)) {
      return { correct: false, matchedMisconceptionIndex: input.misconceptions.length ? 0 : null, feedback: 'No answer given yet.' }
    }
    const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? [])
    const keyWords = words(input.answerKey)
    const answerWords = words(answer)
    const overlap = [...keyWords].filter((w) => answerWords.has(w)).length
    const correct = answerWords.size >= 3 && overlap / Math.max(keyWords.size, 1) >= 0.3
    return {
      correct,
      matchedMisconceptionIndex: null,
      feedback: correct
        ? 'Offline grader: your answer covers the key terms.'
        : 'Offline grader: your answer misses most of the key terms from the reference answer.',
    }
  }

  async streamTutor(input: TutorInput, meta: { onText: (delta: string) => void }): Promise<string> {
    const text = `Offline tutor (no AI provider configured). You asked: "${input.message.slice(0, 200)}". Re-read the section of "${input.nodeTitle}" that covers this, then try explaining it back in your own words.`
    for (const piece of text.match(/.{1,24}/g) ?? []) meta.onText(piece)
    return text
  }
}
