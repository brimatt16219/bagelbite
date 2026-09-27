/**
 * Structured-output schemas sent to Claude (`output_config.format`). They are deliberately
 * flat and free of count/length constraints — structured outputs support a JSON-schema subset —
 * and every result is then re-checked by the `normalize*` functions below, which enforce the
 * product rules (node counts, index ranges, 2–4 related topics, etc.) in app code.
 */
import { z } from 'zod'
import { UpstreamError } from '../lib/errors'
import type { ExerciseDraft, LessonDraft, NodeDraft, ScopeResult } from './types'

const riskTier = z.enum(['low', 'medium', 'high'])
const tier = z.enum(['standard', 'extra_scaffolding'])

export const scopeOutputSchema = z.object({
  status: z.enum(['resolved', 'disambiguate', 'unsupported']),
  matchedExistingTopicId: z.string().nullable(),
  topicName: z.string().nullable(),
  topicDescription: z.string().nullable(),
  nodes: z.array(
    z.object({
      title: z.string(),
      objective: z.string(),
      riskTier,
      scaffoldsOn: z.array(z.number().int()),
    }),
  ),
  relatedTopics: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      relationType: z.enum(['prerequisite', 'related', 'deepens', 'branches_from']),
      reason: z.string(),
    }),
  ),
  candidates: z.array(z.object({ name: z.string(), description: z.string() })),
  unsupportedReason: z.string().nullable(),
})
export type ScopeOutput = z.infer<typeof scopeOutputSchema>

const promptSchema = z.object({
  prompt: z.string(),
  kind: z.enum(['recall', 'explain_back', 'apply_scenario']),
  answerKey: z.string(),
  suitableTiers: z.array(tier),
  anticipatedMisconceptions: z.array(z.object({ wrongPattern: z.string(), correction: z.string() })),
})

const exerciseSchema = z.object({
  instructions: z.string(),
  starterCode: z.string(),
  solutionCode: z.string(),
  testSpec: z.string(),
  suitableTiers: z.array(tier),
})

export const lessonOutputSchema = z.object({
  explanationMarkdown: z.string(),
  claims: z.array(z.object({ claim: z.string(), supportingSourceIndex: z.number().int() })),
  prompts: z.array(promptSchema),
  exercises: z.array(exerciseSchema),
})

export const exerciseRepairOutputSchema = z.object({ exercises: z.array(exerciseSchema) })

export const verifyOutputSchema = z.object({
  passed: z.boolean(),
  concerns: z.array(z.string()),
})

export const hedgeOutputSchema = z.object({ explanationMarkdown: z.string() })

export const gradeOutputSchema = z.object({
  correct: z.boolean(),
  matchedMisconceptionIndex: z.number().int().nullable(),
  feedback: z.string(),
})

// ---------------------------------------------------------------- normalization

/** Model output that parsed but can't be used safely — surfaced to users as a retryable upstream failure. */
export class AiOutputError extends UpstreamError {
  constructor(detail: string) {
    super("Couldn't prepare this content right now. Try again in a moment.", detail)
  }
}

export const MIN_NODES = 4
export const MAX_NODES = 14

/** Enforces the scoping contract; throws AiOutputError on output that can't be used safely. */
export function normalizeScope(out: ScopeOutput, allowedTopicIds: Set<string>): ScopeResult {
  if (out.status === 'unsupported') {
    return {
      status: 'unsupported',
      message:
        out.unsupportedReason?.trim() ||
        'Bagelbite currently teaches programming and tech topics only. Try a programming topic.',
    }
  }
  if (out.status === 'disambiguate') {
    const candidates = out.candidates
      .map((c) => ({ name: c.name.trim(), description: c.description.trim() }))
      .filter((c) => c.name)
      .slice(0, 4)
    if (candidates.length < 2) throw new AiOutputError('Disambiguation returned fewer than 2 candidates')
    return { status: 'disambiguate', candidates }
  }

  const topicName = out.topicName?.trim()
  if (!topicName) throw new AiOutputError('Resolved scope has no topic name')
  const matched = out.matchedExistingTopicId && allowedTopicIds.has(out.matchedExistingTopicId) ? out.matchedExistingTopicId : null

  const nodes: NodeDraft[] = out.nodes
    .slice(0, MAX_NODES)
    .map((n, i) => ({
      title: n.title.trim(),
      objective: n.objective.trim(),
      riskTier: n.riskTier,
      // Prerequisites must point strictly backwards — guarantees an acyclic unlock graph.
      scaffoldsOn: [...new Set(n.scaffoldsOn)].filter((j) => Number.isInteger(j) && j >= 0 && j < i),
    }))
    .filter((n) => n.title && n.objective)
  if (!matched && nodes.length < MIN_NODES) {
    throw new AiOutputError(`Skeleton has ${nodes.length} nodes; need at least ${MIN_NODES}`)
  }
  if (nodes.length && nodes[0].scaffoldsOn.length) nodes[0].scaffoldsOn = []

  const relatedTopics = out.relatedTopics
    .map((r) => ({ ...r, name: r.name.trim(), reason: r.reason.trim(), description: r.description.trim() }))
    .filter((r) => r.name && r.name.toLowerCase() !== topicName.toLowerCase())
    .slice(0, 4)

  return {
    status: 'resolved',
    matchedExistingTopicId: matched,
    topicName,
    topicDescription: out.topicDescription?.trim() ?? '',
    nodes,
    relatedTopics,
  }
}

export const MIN_PROMPTS = 3

export function normalizeLesson(out: z.infer<typeof lessonOutputSchema>, sourceCount: number): LessonDraft {
  const explanationMarkdown = out.explanationMarkdown.trim()
  if (!explanationMarkdown) throw new AiOutputError('Lesson has no explanation')
  const prompts = out.prompts
    .filter((p) => p.prompt.trim() && p.answerKey.trim())
    .map((p) => ({
      ...p,
      suitableTiers: p.suitableTiers.length ? [...new Set(p.suitableTiers)] : (['standard', 'extra_scaffolding'] as const).slice(),
      anticipatedMisconceptions: p.anticipatedMisconceptions.filter((m) => m.wrongPattern.trim() && m.correction.trim()),
    }))
  if (prompts.length < MIN_PROMPTS) throw new AiOutputError(`Lesson has ${prompts.length} retrieval prompts; need ${MIN_PROMPTS}`)
  return {
    explanationMarkdown,
    claims: out.claims.filter((c) => c.claim.trim() && c.supportingSourceIndex >= 0 && c.supportingSourceIndex < sourceCount),
    prompts,
    exercises: out.exercises.map(normalizeExercise),
  }
}

export function normalizeExercise(e: ExerciseDraft): ExerciseDraft {
  return {
    ...e,
    instructions: e.instructions.trim(),
    suitableTiers: e.suitableTiers.length ? [...new Set(e.suitableTiers)] : ['standard', 'extra_scaffolding'],
  }
}
