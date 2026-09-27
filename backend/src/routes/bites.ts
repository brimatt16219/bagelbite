import { Router } from 'express'
import type { BiteDto } from '@shared/api'
import { currentUser } from '../auth/middleware'
import { composeBite } from '../learning/bites'
import { uuidParam } from '../lib/http'
import type { AppDeps } from '../app'

export function bitesRouter(deps: AppDeps): Router {
  const router = Router()

  router.get('/bites/:id', async (req, res) => {
    const { uid } = currentUser(req)
    const biteId = uuidParam(req.params.id, 'Bite')
    const body: BiteDto = await composeBite(deps, uid, biteId)
    res.json(body)
  })

  return router
}
