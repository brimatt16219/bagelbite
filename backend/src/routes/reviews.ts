import { Router } from 'express'
import { z } from 'zod'
import type { DashboardDto, DueReviewsResponse, RatingResult } from '@shared/api'
import { currentUser } from '../auth/middleware'
import { rateReviewLog } from '../learning/retrieval'
import { dueReviews } from '../learning/composer'
import { countDueReviews, listEnrollments } from '../content/progress'
import { uuidParam } from '../lib/http'
import type { AppDeps } from '../app'

const ratingSchema = z.object({ rating: z.enum(['again', 'hard', 'good', 'easy']) })

export function reviewsRouter(deps: AppDeps): Router {
  const router = Router()

  router.post('/review-logs/:id/rating', async (req, res) => {
    const { uid } = currentUser(req)
    const logId = uuidParam(req.params.id, 'Answer')
    const { rating } = ratingSchema.parse(req.body)
    const body: RatingResult = await rateReviewLog(deps, uid, logId, rating)
    res.json(body)
  })

  router.get('/users/me/reviews/due', async (req, res) => {
    const { uid } = currentUser(req)
    const topicId = typeof req.query.topicId === 'string' ? uuidParam(req.query.topicId, 'Topic') : undefined
    const body: DueReviewsResponse = { reviews: await dueReviews(deps.db, uid, deps.clock.now(), topicId) }
    res.json(body)
  })

  router.get('/users/me/dashboard', async (req, res) => {
    const { uid } = currentUser(req)
    const now = deps.clock.now()
    const enrollments = await listEnrollments(deps.db, uid, now)
    const body: DashboardDto = {
      enrollments,
      dueReviewCount: await countDueReviews(deps.db, uid, now),
      masteredTotal: enrollments.reduce((sum, e) => sum + e.masteredCount, 0),
      nodeTotal: enrollments.reduce((sum, e) => sum + e.nodeCount, 0),
    }
    res.json(body)
  })

  return router
}
