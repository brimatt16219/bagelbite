import { Router } from 'express'
import { z } from 'zod'
import type { BiteDto, RetrievalResponseResult } from '@shared/api'
import { currentUser } from '../auth/middleware'
import { composeBite } from '../learning/bites'
import { respondToPrompt } from '../learning/retrieval'
import { uuidParam } from '../lib/http'
import type { AppDeps } from '../app'

const responseSchema = z.object({
  response: z.string().trim().min(1, 'Write an answer first').max(2000),
  confidence: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
})

export function bitesRouter(deps: AppDeps): Router {
  const router = Router()

  router.get('/bites/:id', async (req, res) => {
    const { uid } = currentUser(req)
    const biteId = uuidParam(req.params.id, 'Bite')
    const body: BiteDto = await composeBite(deps, uid, biteId)
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

  return router
}
