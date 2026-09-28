import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import ReviewsPage from './ReviewsPage'
import { ToastProvider } from '../../components/ui/ToastProvider'
import { api } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, api: { dueReviews: vi.fn(), respond: vi.fn(), rate: vi.fn() } }
})
const mocked = vi.mocked(api)

const review = (n: number) => ({
  reviewItemId: `r${n}`, promptId: `p${n}`, prompt: `Question ${n}?`, kind: 'recall' as const, biteId: 'b1',
  topicId: 't1', topicName: 'React', nodeTitle: 'Hooks', dueAt: '2026-09-04T09:00:00Z',
})

describe('ReviewsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('walks through due questions one at a time and summarizes the session', async () => {
    mocked.dueReviews.mockResolvedValue({ reviews: [review(1), review(2)] })
    mocked.respond.mockResolvedValue({ logId: 'l', correct: true, feedback: 'Right.', answerKey: 'k', gradingSource: 'live', suggestedRating: 'good' })
    mocked.rate
      .mockResolvedValueOnce({ nextDueAt: 'x', nodeMastered: false, unlockedBiteIds: [], teachingComplete: true })
      .mockResolvedValueOnce({ nextDueAt: 'x', nodeMastered: true, unlockedBiteIds: ['b2'], teachingComplete: true })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/reviews']}>
            <ReviewsPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )

    for (const n of [1, 2]) {
      expect(await screen.findByText(`Question ${n}?`)).toBeInTheDocument()
      expect(screen.getByText(`${n} of 2 · React — Hooks`)).toBeInTheDocument()
      const next = screen.getByRole('button', { name: n === 1 ? 'Next question' : 'Finish' })
      expect(next).toBeDisabled() // can't skip ahead before answering and rating
      await userEvent.type(screen.getByLabelText('Your answer'), 'answer')
      await userEvent.click(screen.getByRole('radio', { name: 'Fairly sure' }))
      await userEvent.click(screen.getByRole('button', { name: 'Check my answer' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Good' }))
      await userEvent.click(next)
    }

    expect(await screen.findByText('All caught up')).toBeInTheDocument()
    expect(screen.getByText(/You reviewed 2 questions and mastered 1 bite/)).toBeInTheDocument()
    expect(mocked.respond).toHaveBeenCalledWith('b1', 'p2', { response: 'answer', confidence: 3 })
  })

  it('shows an empty state when nothing is due', async () => {
    mocked.dueReviews.mockResolvedValue({ reviews: [] })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ReviewsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Nothing is due right now')).toBeInTheDocument()
  })
})
