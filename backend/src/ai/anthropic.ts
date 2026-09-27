import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'
import { UpstreamError } from '../lib/errors'
import * as prompts from './prompts'
import {
  AiOutputError,
  exerciseRepairOutputSchema,
  gradeOutputSchema,
  hedgeOutputSchema,
  lessonOutputSchema,
  normalizeExercise,
  normalizeLesson,
  normalizeScope,
  scopeOutputSchema,
  verifyOutputSchema,
} from './schemas'
import type { AiMeta, AiService, GradeResult, TutorInput } from './types'
import type { CallType, UsageRecorder } from './usage'

export interface AnthropicAiOptions {
  apiKey?: string
  generationModel: string
  gradingModel: string
  usage: UsageRecorder
  /** Injected for tests; defaults to a real SDK client. */
  client?: Anthropic
}

type Effort = 'low' | 'medium' | 'high'

interface StructuredCall<S extends z.ZodType> {
  callType: CallType
  model: string
  system: string
  user: string
  schema: S
  maxTokens: number
  effort?: Effort
  meta: AiMeta
}

const GENERATION_FAILED = "Couldn't prepare this content right now. Try again in a moment."
const GRADING_FAILED = "Couldn't grade that answer right now. Try again."
const TUTOR_FAILED = "The tutor couldn't respond right now. Try again."

/**
 * Sampling parameters: Claude Sonnet 5 (and newer Opus/Fable models) reject `temperature` with a
 * 400, so the docs' "temperature 0–0.3 for generation" rule can't be applied there — consistency
 * comes from structured outputs instead (PROJECT_NOTES §2.4). Haiku 4.5 still accepts it, so
 * grading runs deterministic at temperature 0.
 */
function acceptsTemperature(model: string): boolean {
  return model.startsWith('claude-haiku')
}

/** Haiku 4.5 errors on `effort`; the 4.6+ Sonnet/Opus models accept it. */
function acceptsEffort(model: string): boolean {
  return !model.startsWith('claude-haiku')
}

export class AnthropicAiService implements AiService {
  readonly source = 'anthropic' as const
  private readonly client: Anthropic

  constructor(private readonly opts: AnthropicAiOptions) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 180_000 })
  }

  private async structured<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S>> {
    const started = performance.now()
    const failMessage = call.callType === 'grading' ? GRADING_FAILED : GENERATION_FAILED
    try {
      const response = await this.client.messages.parse({
        model: call.model,
        max_tokens: call.maxTokens,
        system: call.system,
        messages: [{ role: 'user', content: call.user }],
        output_config: {
          format: zodOutputFormat(call.schema),
          ...(call.effort && acceptsEffort(call.model) ? { effort: call.effort } : {}),
        },
        ...(acceptsTemperature(call.model) ? { temperature: 0 } : {}),
      })
      await this.recordUsage(call.callType, call.model, response.usage, started, true, undefined, call.meta.userId)

      if (response.stop_reason === 'refusal') throw new UpstreamError(failMessage, `refusal on ${call.callType}`)
      if (response.stop_reason === 'max_tokens') throw new UpstreamError(failMessage, `max_tokens on ${call.callType}`)
      if (!response.parsed_output) throw new AiOutputError(`No parsed output for ${call.callType}`)
      return response.parsed_output as z.infer<S>
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        await this.recordUsage(call.callType, call.model, null, started, false, String(err.status ?? err.name), call.meta.userId)
        throw new UpstreamError(failMessage, err)
      }
      throw err
    }
  }

  private async recordUsage(
    callType: CallType,
    model: string,
    usage: Anthropic.Usage | null,
    started: number,
    success: boolean,
    errorCode: string | undefined,
    userId: string | undefined,
  ) {
    await this.opts.usage.record({
      callType,
      provider: 'anthropic',
      model,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
      latencyMs: performance.now() - started,
      success,
      errorCode,
      userId,
    })
  }

  async scope(input: Parameters<AiService['scope']>[0], meta: AiMeta) {
    const out = await this.structured({
      callType: 'scope_skeleton',
      model: this.opts.generationModel,
      system: prompts.SCOPE_SYSTEM,
      user: prompts.scopeUser(input),
      schema: scopeOutputSchema,
      maxTokens: 12_000,
      effort: 'medium',
      meta,
    })
    return normalizeScope(out, new Set(input.similarTopics.map((t) => t.id)))
  }

  async generateLesson(input: Parameters<AiService['generateLesson']>[0], meta: AiMeta) {
    const out = await this.structured({
      callType: 'lesson_generation',
      model: this.opts.generationModel,
      system: prompts.LESSON_SYSTEM,
      user: prompts.lessonUser(input),
      schema: lessonOutputSchema,
      maxTokens: 16_000,
      effort: 'medium',
      meta,
    })
    return normalizeLesson(out, input.grounding?.length ?? 0)
  }

  async repairExercises(input: Parameters<AiService['repairExercises']>[0], meta: AiMeta) {
    const out = await this.structured({
      callType: 'exercise_repair',
      model: this.opts.generationModel,
      system: prompts.EXERCISE_REPAIR_SYSTEM,
      user: prompts.exerciseRepairUser(input),
      schema: exerciseRepairOutputSchema,
      maxTokens: 12_000,
      effort: 'medium',
      meta,
    })
    return out.exercises.map(normalizeExercise)
  }

  async verifyLesson(input: Parameters<AiService['verifyLesson']>[0], meta: AiMeta) {
    const out = await this.structured({
      callType: 'verification',
      model: this.opts.generationModel,
      system: prompts.VERIFY_SYSTEM,
      user: prompts.verifyUser(input),
      schema: verifyOutputSchema,
      maxTokens: 8_000,
      effort: 'high',
      meta,
    })
    const concerns = out.concerns.map((c) => c.trim()).filter(Boolean)
    // A "pass" with concerns listed is treated as a fail — the verifier must be unambiguous.
    return { passed: out.passed && concerns.length === 0, concerns }
  }

  async hedgeLesson(input: Parameters<AiService['hedgeLesson']>[0], meta: AiMeta) {
    const out = await this.structured({
      callType: 'hedge',
      model: this.opts.generationModel,
      system: prompts.HEDGE_SYSTEM,
      user: prompts.hedgeUser(input),
      schema: hedgeOutputSchema,
      maxTokens: 8_000,
      effort: 'medium',
      meta,
    })
    if (!out.explanationMarkdown.trim()) throw new AiOutputError('Hedged lesson is empty')
    return { explanationMarkdown: out.explanationMarkdown.trim() }
  }

  async grade(input: Parameters<AiService['grade']>[0], meta: AiMeta): Promise<GradeResult> {
    const out = await this.structured({
      callType: 'grading',
      model: this.opts.gradingModel,
      system: prompts.GRADE_SYSTEM,
      user: prompts.gradeUser(input),
      schema: gradeOutputSchema,
      maxTokens: 1_024,
      meta,
    })
    const index = out.matchedMisconceptionIndex
    return {
      correct: out.correct,
      matchedMisconceptionIndex:
        !out.correct && index !== null && index >= 0 && index < input.misconceptions.length ? index : null,
      feedback: out.feedback.trim(),
    }
  }

  async streamTutor(input: TutorInput, meta: AiMeta & { onText: (delta: string) => void; signal?: AbortSignal }) {
    const model = this.opts.generationModel
    const started = performance.now()
    try {
      const stream = this.client.messages.stream(
        {
          model,
          max_tokens: 2_048,
          // Thinking off for the tutor: responses should start streaming immediately.
          thinking: { type: 'disabled' },
          // The bite context is identical across turns of one conversation — cache it.
          system: [{ type: 'text', text: prompts.tutorSystem(input), cache_control: { type: 'ephemeral' } }],
          messages: [
            ...input.history.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: prompts.tutorUserTurn(input) },
          ],
        },
        { signal: meta.signal },
      )
      stream.on('text', (delta) => meta.onText(delta))
      const final = await stream.finalMessage()
      await this.recordUsage('chat_tutor', model, final.usage, started, true, undefined, meta.userId)
      if (final.stop_reason === 'refusal') throw new UpstreamError(TUTOR_FAILED, 'tutor refusal')
      return final.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        await this.recordUsage('chat_tutor', model, null, started, false, String(err.status ?? err.name), meta.userId)
        throw new UpstreamError(TUTOR_FAILED, err)
      }
      throw err
    }
  }
}
