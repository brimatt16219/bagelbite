import { Router } from 'express'
import { z } from 'zod'
import type {
  AttemptResult,
  BiteDto,
  ChatMessageDto,
  ChatStreamEvent,
  FlagResult,
  RetrievalResponseResult,
  RevealSolutionResult,
} from '@shared/api'
import { currentUser } from '../auth/middleware'
import { composeBite } from '../learning/bites'
import { respondToPrompt } from '../learning/retrieval'
import { recordAttempt, revealSolution } from '../learning/attempts'
import { chatHistory, prepareTutorTurn } from '../learning/chat'
import { flagContent } from '../content/flags'
import { HttpError } from '../lib/errors'
import { uuidParam } from '../lib/http'
import type { AppDeps } from '../app'

const responseSchema = z.object({
  response: z.string().trim().min(1, 'Write an answer first').max(2000),
  confidence: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
})

const attemptSchema = z.object({
  code: z.string().max(20_000),
  passed: z.boolean(),
  testsPassed: z.number().int().min(0).max(1000),
  testsTotal: z.number().int().min(0).max(1000),
  timeTakenMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
})

const flagSchema = z.object({
  targetType: z.enum(['lesson_variant', 'retrieval_prompt', 'exercise']),
  targetId: z.string().uuid(),
  reason: z.string().max(500).optional(),
})

const chatSchema = z.object({
  message: z.string().trim().min(1, 'Ask a question first').max(2000),
  code: z.string().max(20_000).optional(),
  testOutput: z.string().max(8_000).optional(),
})

export function bitesRouter(deps: AppDeps): Router {
  const router = Router()

  router.get('/bites/:id', async (req, res) => {
    const { uid } = currentUser(req)
    const body: BiteDto = await composeBite(deps, uid, uuidParam(req.params.id, 'Bite'))
    res.json(body)
  })

  router.post('/bites/:id/retrieval-prompts/:promptId/response', async (req, res) => {
    const { uid } = currentUser(req)
    const biteId = uuidParam(req.params.id, 'Bite')
    const promptId = uuidParam(req.params.promptId, 'Question')
    const { response, confidence } = responseSchema.parse(req.body)
    const body: RetrievalResponseResult = await respondToPrompt(deps, uid, biteId, promptId, response, confidence)
    res.status(201).json(body)
  })

  router.post('/bites/:id/attempts', async (req, res) => {
    const { uid } = currentUser(req)
    const body: AttemptResult = await recordAttempt(deps, uid, uuidParam(req.params.id, 'Bite'), attemptSchema.parse(req.body))
    res.status(201).json(body)
  })

  router.post('/bites/:id/reveal-solution', async (req, res) => {
    const { uid } = currentUser(req)
    const body: RevealSolutionResult = await revealSolution(deps, uid, uuidParam(req.params.id, 'Bite'))
    res.json(body)
  })

  router.post('/bites/:id/flag', async (req, res) => {
    const { uid } = currentUser(req)
    const body: FlagResult = await flagContent(deps, uid, uuidParam(req.params.id, 'Bite'), flagSchema.parse(req.body))
    res.status(201).json(body)
  })

  router.get('/bites/:id/chat', async (req, res) => {
    const { uid } = currentUser(req)
    const body: ChatMessageDto[] = await chatHistory(deps.db, uid, uuidParam(req.params.id, 'Bite'))
    res.json(body)
  })

  // Server-sent events. Validation errors are normal JSON responses; once streaming has started,
  // failures are reported as an `error` event because the status line has already been sent.
  router.post('/bites/:id/chat', async (req, res) => {
    const { uid } = currentUser(req)
    const input = chatSchema.parse(req.body)
    const run = await prepareTutorTurn(deps, uid, uuidParam(req.params.id, 'Bite'), input)

    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    const send = (event: ChatStreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`)

    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) abort.abort()
    })
    try {
      const messageId = await run((text) => send({ type: 'delta', text }), abort.signal)
      send({ type: 'done', messageId })
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error('[chat]', err)
        send({ type: 'error', message: err instanceof HttpError ? err.message : "The tutor couldn't respond right now. Try again." })
      }
    }
    res.end()
  })

  return router
}
