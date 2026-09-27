/**
 * Semantic AI boundary. Business logic depends on this interface, never on the Anthropic SDK
 * directly — the real implementation (anthropic.ts), the keyless dev implementation
 * (offline.ts) and the scripted test fake all satisfy it.
 */
import type { ContentSource, PromptKind, RelationType, RiskTier, ScaffoldingTier } from '@shared/api'
import type { GroundingSource } from '../db/schema'

export interface AiMeta {
  userId?: string
}

// ---------------------------------------------------------------- scoping + skeleton (Sonnet)

export interface ScopeInput {
  topic: string
  baseline: string
  /** Existing topics with a similar name — lets the model say "this is topic X" (dedup, no extra call). */
  similarTopics: { id: string; name: string }[]
}

export interface NodeDraft {
  title: string
  objective: string
  riskTier: RiskTier
  /** 0-based indices of earlier nodes this node genuinely depends on. */
  scaffoldsOn: number[]
}

export interface RelatedTopicDraft {
  name: string
  description: string
  relationType: RelationType
  reason: string
}

export type ScopeResult =
  | {
      status: 'resolved'
      matchedExistingTopicId: string | null
      topicName: string
      topicDescription: string
      nodes: NodeDraft[]
      relatedTopics: RelatedTopicDraft[]
    }
  | { status: 'disambiguate'; candidates: { name: string; description: string }[] }
  | { status: 'unsupported'; message: string }

// ---------------------------------------------------------------- lesson bundle (Sonnet)

export interface LessonInput {
  topicName: string
  nodeTitle: string
  objective: string
  riskTier: RiskTier
  tier: ScaffoldingTier
  prerequisiteTitles: string[]
  /** Present for medium/high-tier nodes when grounding ran. */
  grounding: GroundingSource[] | null
  /** Verifier concerns from a failed high-tier check, fed back on the single retry. */
  revisionNotes?: string[]
}

export interface PromptDraft {
  prompt: string
  kind: PromptKind
  answerKey: string
  suitableTiers: ScaffoldingTier[]
  anticipatedMisconceptions: { wrongPattern: string; correction: string }[]
}

export interface ExerciseDraft {
  instructions: string
  starterCode: string
  solutionCode: string
  testSpec: string
  suitableTiers: ScaffoldingTier[]
}

export interface LessonDraft {
  explanationMarkdown: string
  claims: { claim: string; supportingSourceIndex: number }[]
  prompts: PromptDraft[]
  exercises: ExerciseDraft[]
}

export interface ExerciseRepairInput extends LessonInput {
  explanationMarkdown: string
  failures: { exercise: ExerciseDraft; problem: string }[]
}

// ---------------------------------------------------------------- verification (Sonnet, high tier only)

export interface VerifyInput {
  topicName: string
  nodeTitle: string
  objective: string
  explanationMarkdown: string
  exercises: ExerciseDraft[]
  grounding: GroundingSource[] | null
}

export interface VerifyResult {
  passed: boolean
  concerns: string[]
}

export interface HedgeInput extends VerifyInput {
  concerns: string[]
}

// ---------------------------------------------------------------- grading (Haiku)

export interface GradeInput {
  prompt: string
  kind: PromptKind
  answerKey: string
  misconceptions: { wrongPattern: string; correction: string }[]
  response: string
}

export interface GradeResult {
  correct: boolean
  /** Index into `misconceptions` when the wrong answer matches an anticipated pattern. */
  matchedMisconceptionIndex: number | null
  feedback: string
}

// ---------------------------------------------------------------- chat tutor (Sonnet, streamed)

export interface TutorInput {
  topicName: string
  nodeTitle: string
  objective: string
  baseline: string
  explanationMarkdown: string
  exerciseInstructions: string | null
  code: string | null
  testOutput: string | null
  /** Already capped to the last few turns by the caller. */
  history: { role: 'user' | 'assistant'; content: string }[]
  message: string
}

export interface AiService {
  readonly source: ContentSource
  scope(input: ScopeInput, meta: AiMeta): Promise<ScopeResult>
  generateLesson(input: LessonInput, meta: AiMeta): Promise<LessonDraft>
  repairExercises(input: ExerciseRepairInput, meta: AiMeta): Promise<ExerciseDraft[]>
  verifyLesson(input: VerifyInput, meta: AiMeta): Promise<VerifyResult>
  hedgeLesson(input: HedgeInput, meta: AiMeta): Promise<{ explanationMarkdown: string }>
  grade(input: GradeInput, meta: AiMeta): Promise<GradeResult>
  streamTutor(input: TutorInput, meta: AiMeta & { onText: (delta: string) => void; signal?: AbortSignal }): Promise<string>
}
