/**
 * Postgres schema. Shape follows vault Architecture.md "Data model (sketch)" + Content-Sharing.md:
 * shared content (topics → skeletons → nodes → lesson variants / banks) is generated once and
 * reused across users; personalization lives in user_topic_progress, user_node_states and the
 * FSRS review tables. Additions beyond the sketch are listed in PROJECT_NOTES.md §2.25.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { Card } from 'ts-fsrs'

// ------------------------------------------------------------------ enums

export const riskTierEnum = pgEnum('risk_tier', ['low', 'medium', 'high'])
export const scaffoldingTierEnum = pgEnum('scaffolding_tier', ['standard', 'extra_scaffolding'])
export const nodeStatusEnum = pgEnum('node_status', ['locked', 'available', 'in_progress', 'mastered'])
export const enrollmentStatusEnum = pgEnum('enrollment_status', ['in_progress', 'completed', 'abandoned'])
export const promptKindEnum = pgEnum('prompt_kind', ['recall', 'explain_back', 'apply_scenario'])
export const relationTypeEnum = pgEnum('relation_type', ['prerequisite', 'related', 'deepens', 'branches_from'])
export const reviewRatingEnum = pgEnum('review_rating', ['again', 'hard', 'good', 'easy'])
export const flagTargetTypeEnum = pgEnum('flag_target_type', ['lesson_variant', 'retrieval_prompt', 'exercise'])
export const flagStatusEnum = pgEnum('flag_status', ['open', 'reviewed', 'dismissed'])
export const skeletonVisibilityEnum = pgEnum('skeleton_visibility', ['canonical', 'private', 'unlisted', 'published'])
// Reserved discriminator (Interaction-Components.md) — v1 only ever writes 'code_exercise'.
export const componentTypeEnum = pgEnum('component_type', [
  'code_exercise',
  'production_prompt',
  'problem_set',
  'case_study_response',
])
export const subscriptionTierEnum = pgEnum('subscription_tier', ['free', 'pro'])
export const chatRoleEnum = pgEnum('chat_role', ['user', 'assistant'])
export const gradingSourceEnum = pgEnum('grading_source', ['misconception_bank', 'live'])
export const contentSourceEnum = pgEnum('content_source', ['anthropic', 'offline', 'fake'])

// ------------------------------------------------------------------ json shapes

export interface GroundingSource {
  url: string
  title: string
  snippet: string
}
export interface Claim {
  claim: string
  supportingSourceIndex: number
}
export interface Misconception {
  wrongPattern: string
  correction: string
}
export interface Verification {
  status: 'passed' | 'hedged'
  concerns: string[]
  attempts: number
}
export type GroundingStatus = 'not_required' | 'grounded' | 'unavailable'
/** A ts-fsrs Card with dates serialized as ISO strings (jsonb has no Date type). */
export type StoredFsrsCard = Omit<Card, 'due' | 'last_review'> & { due: string; last_review: string | null }

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

// ------------------------------------------------------------------ users

export const users = pgTable('users', {
  id: text('id').primaryKey(), // Firebase UID
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default(''),
  photoUrl: text('photo_url').notNull().default(''),
  // Reserved for the future Stripe tier (Decisions 2026-07-01). Everyone is 'free' in v1.
  subscriptionTier: subscriptionTierEnum('subscription_tier').notNull().default('free'),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
})

// ------------------------------------------------------------------ shared: topic graph

export const topics = pgTable('topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull().unique(),
  description: text('description').notNull().default(''),
  createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
})

export const topicRelations = pgTable(
  'topic_relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromTopicId: uuid('from_topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    toTopicId: uuid('to_topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    relationType: relationTypeEnum('relation_type').notNull(),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('topic_relations_edge_uq').on(t.fromTopicId, t.toTopicId, t.relationType)],
)

// ------------------------------------------------------------------ shared: curriculum

export const curriculumSkeletons = pgTable(
  'curriculum_skeletons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    contentSource: contentSourceEnum('content_source').notNull(),
    createdAt: createdAt(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    // Course-Bank.md (post-v1): null/'canonical' for every v1 row.
    authorUserId: text('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    visibility: skeletonVisibilityEnum('visibility').notNull().default('canonical'),
  },
  (t) => [
    // At most one current canonical skeleton per topic.
    uniqueIndex('curriculum_skeletons_current_canonical_uq')
      .on(t.topicId)
      .where(sql`${t.visibility} = 'canonical' and ${t.supersededAt} is null`),
  ],
)

export const skeletonNodes = pgTable(
  'skeleton_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    curriculumSkeletonId: uuid('curriculum_skeleton_id')
      .notNull()
      .references(() => curriculumSkeletons.id, { onDelete: 'cascade' }),
    orderIndex: integer('order_index').notNull(),
    title: text('title').notNull(),
    objective: text('objective').notNull(),
    riskTier: riskTierEnum('risk_tier').notNull(),
    scaffoldsOn: uuid('scaffolds_on').array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('skeleton_nodes_order_uq').on(t.curriculumSkeletonId, t.orderIndex)],
)

export const lessonVariants = pgTable(
  'lesson_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skeletonNodeId: uuid('skeleton_node_id')
      .notNull()
      .references(() => skeletonNodes.id, { onDelete: 'cascade' }),
    scaffoldingTier: scaffoldingTierEnum('scaffolding_tier').notNull(),
    explanationMarkdown: text('explanation_markdown').notNull(),
    groundingStatus: text('grounding_status').$type<GroundingStatus>().notNull(),
    groundingSources: jsonb('grounding_sources').$type<GroundingSource[]>(),
    claims: jsonb('claims').$type<Claim[]>(),
    verification: jsonb('verification').$type<Verification>(),
    version: integer('version').notNull().default(1),
    contentSource: contentSourceEnum('content_source').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    suppressedAt: timestamp('suppressed_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [
    // One current variant per (node, tier); regeneration supersedes the old row first.
    uniqueIndex('lesson_variants_current_uq')
      .on(t.skeletonNodeId, t.scaffoldingTier)
      .where(sql`${t.supersededAt} is null`),
  ],
)

export const retrievalPromptBankItems = pgTable(
  'retrieval_prompt_bank_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skeletonNodeId: uuid('skeleton_node_id')
      .notNull()
      .references(() => skeletonNodes.id, { onDelete: 'cascade' }),
    generatedWithLessonVariantId: uuid('generated_with_lesson_variant_id').references(() => lessonVariants.id, {
      onDelete: 'set null',
    }),
    prompt: text('prompt').notNull(),
    kind: promptKindEnum('kind').notNull(),
    answerKey: text('answer_key').notNull(),
    suitableTiers: scaffoldingTierEnum('suitable_tiers').array().notNull(),
    anticipatedMisconceptions: jsonb('anticipated_misconceptions').$type<Misconception[]>().notNull(),
    version: integer('version').notNull().default(1),
    contentSource: contentSourceEnum('content_source').notNull(),
    createdAt: createdAt(),
    suppressedAt: timestamp('suppressed_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [index('retrieval_prompts_node_idx').on(t.skeletonNodeId)],
)

export const exerciseBankItems = pgTable(
  'exercise_bank_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skeletonNodeId: uuid('skeleton_node_id')
      .notNull()
      .references(() => skeletonNodes.id, { onDelete: 'cascade' }),
    generatedWithLessonVariantId: uuid('generated_with_lesson_variant_id').references(() => lessonVariants.id, {
      onDelete: 'set null',
    }),
    componentType: componentTypeEnum('component_type').notNull().default('code_exercise'),
    instructions: text('instructions').notNull(),
    starterCode: text('starter_code').notNull(),
    solutionCode: text('solution_code').notNull(),
    testSpec: text('test_spec').notNull(),
    suitableTiers: scaffoldingTierEnum('suitable_tiers').array().notNull(),
    version: integer('version').notNull().default(1),
    contentSource: contentSourceEnum('content_source').notNull(),
    validatedAt: timestamp('validated_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    suppressedAt: timestamp('suppressed_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [index('exercise_bank_items_node_idx').on(t.skeletonNodeId)],
)

// ------------------------------------------------------------------ personal: progress

export const userTopicProgress = pgTable(
  'user_topic_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    curriculumSkeletonId: uuid('curriculum_skeleton_id')
      .notNull()
      .references(() => curriculumSkeletons.id, { onDelete: 'cascade' }),
    curriculumSkeletonVersion: integer('curriculum_skeleton_version').notNull(),
    selfReportedBaseline: text('self_reported_baseline').notNull(),
    // Reserved for diagnostic pretesting (v1-deferred) — always empty in v1.
    prunedNodeIds: uuid('pruned_node_ids').array().notNull().default(sql`'{}'::uuid[]`),
    status: enrollmentStatusEnum('status').notNull().default('in_progress'),
    percentComplete: integer('percent_complete').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  // Keyed on the skeleton, not the topic (Course-Bank.md fix, 2026-07-08).
  (t) => [uniqueIndex('user_topic_progress_user_skeleton_uq').on(t.userId, t.curriculumSkeletonId)],
)

export const userNodeStates = pgTable(
  'user_node_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userTopicProgressId: uuid('user_topic_progress_id')
      .notNull()
      .references(() => userTopicProgress.id, { onDelete: 'cascade' }),
    skeletonNodeId: uuid('skeleton_node_id')
      .notNull()
      .references(() => skeletonNodes.id, { onDelete: 'cascade' }),
    scaffoldingTier: scaffoldingTierEnum('scaffolding_tier').notNull().default('standard'),
    status: nodeStatusEnum('status').notNull(),
    selectedPromptIds: uuid('selected_prompt_ids').array().notNull().default(sql`'{}'::uuid[]`),
    selectedExerciseId: uuid('selected_exercise_id').references(() => exerciseBankItems.id, { onDelete: 'set null' }),
    solutionRevealedAt: timestamp('solution_revealed_at', { withTimezone: true }),
    createdAt: createdAt(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    teachingCompletedAt: timestamp('teaching_completed_at', { withTimezone: true }),
    // Set when the node is mastered.
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('user_node_states_enrollment_node_uq').on(t.userTopicProgressId, t.skeletonNodeId)],
)

export const learningSessions = pgTable(
  'learning_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
    hadNewContent: boolean('had_new_content').notNull().default(false),
    hadReview: boolean('had_review').notNull().default(false),
  },
  (t) => [index('learning_sessions_user_idx').on(t.userId, t.lastActivityAt)],
)

export const biteAttempts = pgTable(
  'bite_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userNodeStateId: uuid('user_node_state_id')
      .notNull()
      .references(() => userNodeStates.id, { onDelete: 'cascade' }),
    exerciseBankItemId: uuid('exercise_bank_item_id')
      .notNull()
      .references(() => exerciseBankItems.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => learningSessions.id, { onDelete: 'set null' }),
    submittedCode: text('submitted_code').notNull(),
    passed: boolean('passed').notNull(),
    testsPassed: integer('tests_passed').notNull(),
    testsTotal: integer('tests_total').notNull(),
    hintsUsed: integer('hints_used').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    timeTakenMs: integer('time_taken_ms').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('bite_attempts_node_state_idx').on(t.userNodeStateId)],
)

// ------------------------------------------------------------------ personal: spaced repetition

export const reviewItems = pgTable(
  'review_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    retrievalPromptBankItemId: uuid('retrieval_prompt_bank_item_id')
      .notNull()
      .references(() => retrievalPromptBankItems.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userNodeStateId: uuid('user_node_state_id')
      .notNull()
      .references(() => userNodeStates.id, { onDelete: 'cascade' }),
    // Full ts-fsrs card (difficulty, stability, reps, lapses, state…); `due` is denormalized for indexing.
    fsrs: jsonb('fsrs').$type<StoredFsrsCard>().notNull(),
    due: timestamp('due', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('review_items_user_prompt_uq').on(t.userId, t.retrievalPromptBankItemId),
    index('review_items_user_due_idx').on(t.userId, t.due),
  ],
)

export const reviewLogs = pgTable(
  'review_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewItemId: uuid('review_item_id')
      .notNull()
      .references(() => reviewItems.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => learningSessions.id, { onDelete: 'set null' }),
    userResponse: text('user_response').notNull(),
    correct: boolean('correct').notNull(),
    feedback: text('feedback').notNull(),
    gradingSource: gradingSourceEnum('grading_source').notNull(),
    matchedMisconceptionIndex: integer('matched_misconception_index'),
    // Pedagogy #9: self-rated 1–4 before the answer is revealed. A one-way data door.
    confidenceRating: integer('confidence_rating').notNull(),
    isFirstExposure: boolean('is_first_exposure').notNull(),
    // Null until the learner self-rates after the reveal; FSRS is applied at that point.
    rating: reviewRatingEnum('rating'),
    createdAt: createdAt(),
    ratedAt: timestamp('rated_at', { withTimezone: true }),
  },
  (t) => [index('review_logs_item_idx').on(t.reviewItemId)],
)

export const masteryEvents = pgTable('mastery_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  userNodeStateId: uuid('user_node_state_id')
    .notNull()
    .references(() => userNodeStates.id, { onDelete: 'cascade' }),
  skeletonNodeId: uuid('skeleton_node_id')
    .notNull()
    .references(() => skeletonNodes.id, { onDelete: 'cascade' }),
  sessionsCount: integer('sessions_count').notNull(),
  createdAt: createdAt(),
})

// ------------------------------------------------------------------ personal: tutor & flags

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userNodeStateId: uuid('user_node_state_id')
      .notNull()
      .references(() => userNodeStates.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: chatRoleEnum('role').notNull(),
    content: text('content').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('chat_messages_node_state_idx').on(t.userNodeStateId, t.createdAt)],
)

// Targets shared content: a confirmed fix applies to everyone who sees it (Content-Sharing §5).
export const contentFlags = pgTable(
  'content_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: flagTargetTypeEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userNodeStateId: uuid('user_node_state_id').references(() => userNodeStates.id, { onDelete: 'set null' }),
    reason: text('reason'),
    riskTierAtFlag: riskTierEnum('risk_tier_at_flag').notNull(),
    status: flagStatusEnum('status').notNull().default('open'),
    resolutionNote: text('resolution_note'),
    createdAt: createdAt(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [index('content_flags_target_idx').on(t.targetType, t.targetId)],
)

// Reserved for diagnostic pretesting (v1-deferred, MVP-Synthesis flag 1). Never written in v1.
export const pretestResults = pgTable('pretest_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  enrollmentId: uuid('enrollment_id')
    .notNull()
    .references(() => userTopicProgress.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  userAnswer: text('user_answer').notNull(),
  correct: boolean('correct').notNull(),
  createdAt: createdAt(),
})

// ------------------------------------------------------------------ instrumentation (MVP-Synthesis §4)

export const llmCalls = pgTable(
  'llm_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    callType: text('call_type').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull(),
    success: boolean('success').notNull(),
    errorCode: text('error_code'),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('llm_calls_created_idx').on(t.createdAt)],
)

export const biteViewEvents = pgTable('bite_view_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  userNodeStateId: uuid('user_node_state_id')
    .notNull()
    .references(() => userNodeStates.id, { onDelete: 'cascade' }),
  skeletonNodeId: uuid('skeleton_node_id')
    .notNull()
    .references(() => skeletonNodes.id, { onDelete: 'cascade' }),
  scaffoldingTier: scaffoldingTierEnum('scaffolding_tier').notNull(),
  // Shared-content amortization signal: was this (node, tier) already generated?
  cacheHit: boolean('cache_hit').notNull(),
  createdAt: createdAt(),
})
