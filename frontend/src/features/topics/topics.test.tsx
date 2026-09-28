import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import HomePage from './HomePage'
import { DisambiguationPicker } from './DisambiguationPicker'
import { api } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, api: { enroll: vi.fn(), dashboard: vi.fn() } }
})
const mocked = vi.mocked(api)

function renderHome() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <HomePage /> },
      { path: '/topics/:topicId/bites/:biteId', element: <p>bite page</p> },
    ],
    { initialEntries: ['/'] },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.dashboard.mockResolvedValue({ enrollments: [], dueReviewCount: 0, masteredTotal: 0, nodeTotal: 0 })
  })

  it('disambiguates an umbrella topic, then drops the learner into bite 1', async () => {
    mocked.enroll
      .mockResolvedValueOnce({
        status: 'disambiguate',
        candidates: [
          { name: 'ASP.NET Core Web APIs', description: 'HTTP backends' },
          { name: 'Blazor', description: 'Web UI in C#' },
        ],
      })
      .mockResolvedValueOnce({ status: 'resolved', topicId: 't1', topicName: 'ASP.NET Core Web APIs', userTopicProgressId: 'u1', firstBiteId: 'b1', alreadyEnrolled: false })
    const router = renderHome()

    expect(await screen.findByText('Start your first topic')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Topic'), '.NET')
    await userEvent.type(screen.getByLabelText('What you already know'), 'I know Java')
    await userEvent.click(screen.getByRole('button', { name: 'Start learning' }))

    expect(await screen.findByText(/covers several different tracks/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /ASP\.NET Core Web APIs/ }))

    expect(mocked.enroll).toHaveBeenLastCalledWith({ topic: 'ASP.NET Core Web APIs', baseline: 'I know Java' })
    expect(await screen.findByText('bite page')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/topics/t1/bites/b1')
  })

  it('explains out-of-vertical topics', async () => {
    mocked.enroll.mockResolvedValue({ status: 'unsupported', message: 'Bagelbite covers programming and tech topics.' })
    renderHome()
    await userEvent.type(screen.getByLabelText('Topic'), 'Sourdough')
    await userEvent.click(screen.getByRole('button', { name: 'Start learning' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Bagelbite covers programming and tech topics.')
  })
})

describe('DisambiguationPicker', () => {
  it('reports the chosen candidate', async () => {
    const onPick = vi.fn()
    render(<DisambiguationPicker topic="Python" candidates={[{ name: 'Python for data', description: 'pandas' }, { name: 'Django', description: 'web' }]} onPick={onPick} />)
    await userEvent.click(screen.getByRole('button', { name: /Django/ }))
    expect(onPick).toHaveBeenCalledWith({ name: 'Django', description: 'web' })
  })
})
