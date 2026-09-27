import type { Db } from '../db/client'
import { llmCalls } from '../db/schema'

export type CallType =
  | 'scope_skeleton'
  | 'lesson_generation'
  | 'exercise_repair'
  | 'verification'
  | 'hedge'
  | 'grading'
  | 'chat_tutor'
  | 'grounding_search'

export interface UsageEntry {
  callType: CallType
  provider: 'anthropic' | 'tavily' | 'offline'
  model: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  latencyMs: number
  success: boolean
  errorCode?: string
  userId?: string
}

/**
 * Raw token usage per call, tagged by call type and model — MVP-Synthesis §4's most important
 * log (it replaces Cost-Model.md's estimates with real numbers). Failures to log never fail the
 * request that made the call.
 */
export interface UsageRecorder {
  record(entry: UsageEntry): Promise<void>
}

export class DbUsageRecorder implements UsageRecorder {
  constructor(private readonly db: Db) {}

  async record(entry: UsageEntry): Promise<void> {
    try {
      await this.db.insert(llmCalls).values({
        callType: entry.callType,
        provider: entry.provider,
        model: entry.model,
        inputTokens: entry.inputTokens ?? 0,
        outputTokens: entry.outputTokens ?? 0,
        cacheReadTokens: entry.cacheReadTokens ?? 0,
        cacheCreationTokens: entry.cacheCreationTokens ?? 0,
        latencyMs: Math.round(entry.latencyMs),
        success: entry.success,
        errorCode: entry.errorCode ?? null,
        userId: entry.userId ?? null,
      })
    } catch (err) {
      console.error('[usage] failed to record llm call', err)
    }
  }
}
