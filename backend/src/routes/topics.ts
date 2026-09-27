import { Router } from 'express'
import { z } from 'zod'
import type { EnrollResponse, EnrollmentDetail, EnrollmentSummary } from '@shared/api'
import { currentUser } from '../auth/middleware'
import { enroll } from '../content/enrollment'
import { enrollmentDetail, listEnrollments } from '../content/progress'
import { notFound } from '../lib/errors'
import { uuidParam } from '../lib/http'
import type { AppDeps } from '../app'

const enrollSchema = z.object({
  topic: z.string().trim().min(1, 'Enter a topic').max(120),
  baseline: z.string().trim().max(300).default(''),
})

export function topicsRouter(deps: AppDeps): Router {
  const router = Router()

  router.post('/topics/enroll', async (req, res) => {
    const { uid } = currentUser(req)
    const body = enrollSchema.parse(req.body)
    const result: EnrollResponse = await enroll(deps, uid, body.topic, body.baseline)
    res.status(result.status === 'resolved' && !result.alreadyEnrolled ? 201 : 200).json(result)
  })

  router.get('/users/me/enrollments', async (req, res) => {
    const { uid } = currentUser(req)
    const body: EnrollmentSummary[] = await listEnrollments(deps.db, uid, deps.clock.now())
    res.json(body)
  })

  router.get('/topics/:topicId/enrollment', async (req, res) => {
    const { uid } = currentUser(req)
    const topicId = uuidParam(req.params.topicId, 'Enrollment')
    const detail: EnrollmentDetail | null = await enrollmentDetail(deps.db, uid, topicId, deps.clock.now())
    if (!detail) throw notFound('Enrollment')
    res.json(detail)
  })

  return router
}
