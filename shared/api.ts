/**
 * Bagelbite API contract — type-only, imported by both the backend (response shapes) and the
 * frontend (API client). Keep this file free of runtime code: both apps import it with
 * `import type`, so nothing here is ever bundled.
 */

export type RiskTier = 'low' | 'medium' | 'high'
export type ScaffoldingTier = 'standard' | 'extra_scaffolding'
export type NodeStatus = 'locked' | 'available' | 'in_progress' | 'mastered'
export type PromptKind = 'recall' | 'explain_back' | 'apply_scenario'
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'
export type ConfidenceRating = 1 | 2 | 3 | 4
export type ContentSource = 'anthropic' | 'offline' | 'fake'
export type FlagTargetType = 'lesson_variant' | 'retrieval_prompt' | 'exercise'
export type RelationType = 'prerequisite' | 'related' | 'deepens' | 'branches_from'

export interface ApiErrorBody {
  error: { code: string; message: string }
}

export interface UserDto {
  id: string
  email: string
  displayName: string
  photoURL: string
  subscriptionTier: 'free' | 'pro'
}

// ---------------------------------------------------------------- enrollment

export interface EnrollRequest {
  topic: string
  baseline: string
}

export interface TopicCandidate {
  name: string
  description: string
}

export type EnrollResponse =
  | {
      status: 'resolved'
      topicId: string
      topicName: string
      userTopicProgressId: string
      /** First bite to drop the learner into; null only if every node is locked (never for a new skeleton). */
      firstBiteId: string | null
      alreadyEnrolled: boolean
    }
  | { status: 'disambiguate'; candidates: TopicCandidate[] }
  | { status: 'unsupported'; message: string }

export interface EnrollmentSummary {
  userTopicProgressId: string
  topicId: string
  topicName: string
  topicDescription: string
  status: 'in_progress' | 'completed' | 'abandoned'
  /** Mastery-weighted: only mastered nodes count. */
  percentComplete: number
  masteredCount: number
  startedCount: number
  nodeCount: number
  dueReviewCount: number
  startedAt: string
}

export interface CurriculumNodeDto {
  biteId: string
  orderIndex: number
  title: string
  objective: string
  riskTier: RiskTier
  status: NodeStatus
  prerequisiteTitles: string[]
}

export interface RelatedTopicDto {
  topicId: string
  name: string
  relationType: RelationType
  reason: string
}

export interface EnrollmentDetail extends EnrollmentSummary {
  baseline: string
  nodes: CurriculumNodeDto[]
  relatedTopics: RelatedTopicDto[]
}

/** Session composer output — what the learner should do next in a topic. */
export type NextStep =
  | { type: 'reviews'; dueCount: number }
  | { type: 'bite'; biteId: string; title: string }
  | { type: 'waiting'; nextReviewAt: string | null; message: string }
  | { type: 'completed' }

// ---------------------------------------------------------------- bites

export interface GroundingSourceDto {
  url: string
  title: string
  domain: string
}

export type CitationDto =
  | { kind: 'grounded'; sources: GroundingSourceDto[] }
  | { kind: 'ungrounded'; reason: 'low_risk' | 'grounding_unavailable' }

export interface AnsweredPromptDto {
  logId: string
  response: string
  correct: boolean
  feedback: string
  answerKey: string
  confidence: ConfidenceRating
  rating: ReviewRating | null
}

export interface RetrievalPromptDto {
  id: string
  kind: PromptKind
  prompt: string
  /** Index of the explanation section this prompt follows. */
  afterSection: number
  answered: AnsweredPromptDto | null
}

export interface ExerciseDto {
  id: string
  instructions: string
  starterCode: string
  testSpec: string
  /** Only present once the learner has revealed the worked solution. */
  solutionCode: string | null
}

export interface BiteDto {
  id: string
  topicId: string
  topicName: string
  node: {
    title: string
    objective: string
    orderIndex: number
    nodeCount: number
    riskTier: RiskTier
    prerequisiteTitles: string[]
  }
  status: NodeStatus
  scaffoldingTier: ScaffoldingTier
  contentSource: ContentSource
  lesson: {
    id: string
    sections: string[]
    citation: CitationDto
    verification: 'passed' | 'hedged' | null
  }
  prompts: RetrievalPromptDto[]
  exercise: ExerciseDto | null
  attempts: { count: number; passed: boolean; solutionRevealed: boolean; canRevealSolution: boolean }
  teachingComplete: boolean
}

export interface RetrievalResponseRequest {
  response: string
  confidence: ConfidenceRating
}

export interface RetrievalResponseResult {
  logId: string
  correct: boolean
  feedback: string
  answerKey: string
  gradingSource: 'misconception_bank' | 'live'
  suggestedRating: ReviewRating
}

export interface RatingRequest {
  rating: ReviewRating
}

export interface RatingResult {
  nextDueAt: string
  nodeMastered: boolean
  unlockedBiteIds: string[]
  teachingComplete: boolean
}

export interface AttemptRequest {
  code: string
  passed: boolean
  testsPassed: number
  testsTotal: number
  timeTakenMs: number
}

export interface AttemptResult {
  attemptNumber: number
  passed: boolean
  canRevealSolution: boolean
  teachingComplete: boolean
}

export interface RevealSolutionResult {
  solutionCode: string
}

export interface FlagRequest {
  targetType: FlagTargetType
  targetId: string
  reason?: string
}

export interface FlagResult {
  flagId: string
}

// ---------------------------------------------------------------- reviews & dashboard

export interface DueReviewDto {
  reviewItemId: string
  promptId: string
  prompt: string
  kind: PromptKind
  biteId: string
  topicId: string
  topicName: string
  nodeTitle: string
  dueAt: string
}

export interface DueReviewsResponse {
  reviews: DueReviewDto[]
}

export interface DashboardDto {
  enrollments: EnrollmentSummary[]
  dueReviewCount: number
  masteredTotal: number
  nodeTotal: number
}

// ---------------------------------------------------------------- chat tutor

export interface ChatMessageDto {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface ChatRequest {
  message: string
  code?: string
  testOutput?: string
}

/** Server-sent events emitted by POST /bites/:id/chat. */
export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string }
