import { OfflineAiService } from '../src/ai/offline'
import type { AiMeta, AiService } from '../src/ai/types'

type Method = Exclude<keyof AiService, 'source'>

/**
 * Scripted AI for tests: defaults to the deterministic offline templates, records every call,
 * and lets a test override any method (e.g. to force a verification failure).
 */
export class FakeAiService extends OfflineAiService {
  override readonly source = 'fake' as const
  readonly calls: Record<Method, unknown[]> = {
    scope: [],
    generateLesson: [],
    repairExercises: [],
    verifyLesson: [],
    hedgeLesson: [],
    grade: [],
    streamTutor: [],
  }
  overrides: Partial<{ [K in Method]: AiService[K] }> = {}

  count(method: Method): number {
    return this.calls[method].length
  }

  override async scope(input: Parameters<AiService['scope']>[0], meta: AiMeta = {}) {
    this.calls.scope.push(input)
    return this.overrides.scope ? this.overrides.scope(input, meta) : super.scope(input)
  }
  override async generateLesson(input: Parameters<AiService['generateLesson']>[0], meta: AiMeta = {}) {
    this.calls.generateLesson.push(input)
    return this.overrides.generateLesson ? this.overrides.generateLesson(input, meta) : super.generateLesson(input)
  }
  override async repairExercises(input: Parameters<AiService['repairExercises']>[0], meta: AiMeta = {}) {
    this.calls.repairExercises.push(input)
    return this.overrides.repairExercises ? this.overrides.repairExercises(input, meta) : super.repairExercises(input)
  }
  override async verifyLesson(input: Parameters<AiService['verifyLesson']>[0], meta: AiMeta = {}) {
    this.calls.verifyLesson.push(input)
    return this.overrides.verifyLesson ? this.overrides.verifyLesson(input, meta) : super.verifyLesson(input)
  }
  override async hedgeLesson(input: Parameters<AiService['hedgeLesson']>[0], meta: AiMeta = {}) {
    this.calls.hedgeLesson.push(input)
    return this.overrides.hedgeLesson ? this.overrides.hedgeLesson(input, meta) : super.hedgeLesson(input)
  }
  override async grade(input: Parameters<AiService['grade']>[0], meta: AiMeta = {}) {
    this.calls.grade.push(input)
    return this.overrides.grade ? this.overrides.grade(input, meta) : super.grade(input)
  }
  override async streamTutor(
    input: Parameters<AiService['streamTutor']>[0],
    meta: Parameters<AiService['streamTutor']>[1],
  ) {
    this.calls.streamTutor.push(input)
    return this.overrides.streamTutor ? this.overrides.streamTutor(input, meta) : super.streamTutor(input, meta)
  }
}
