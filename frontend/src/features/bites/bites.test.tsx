import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RetrievalPromptCard } from './RetrievalPromptCard'
import { CitationElement } from './CitationElement'
import { FlagButton } from './FlagButton'
import { ToastProvider } from '../../components/ui/ToastProvider'
import { api } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, api: { respond: vi.fn(), rate: vi.fn(), flag: vi.fn() } }
})

const mocked = vi.mocked(api)
const prompt = { id: 'p1', kind: 'recall' as const, prompt: 'What does useEffect do?' }
const renderCard = (onRated = vi.fn()) =>
  render(
    <ToastProvider>
      <RetrievalPromptCard biteId="b1" prompt={prompt} onRated={onRated} />
    </ToastProvider>,
  )

describe('RetrievalPromptCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires a confidence rating before the answer can be checked', async () => {
    renderCard()
    await userEvent.type(screen.getByLabelText('Your answer'), 'It runs side effects')
    expect(screen.getByRole('button', { name: 'Check my answer' })).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: 'Fairly sure' }))
    expect(screen.getByRole('button', { name: 'Check my answer' })).toBeEnabled()
  })

  it('reveals feedback and the reference answer, then saves the self-rating', async () => {
    mocked.respond.mockResolvedValue({
      logId: 'log1', correct: true, feedback: 'Yes — after render.', answerKey: 'Runs side effects after render.', gradingSource: 'live', suggestedRating: 'good',
    })
    mocked.rate.mockResolvedValue({ nextDueAt: '2026-09-04T09:00:00Z', nodeMastered: false, unlockedBiteIds: [], teachingComplete: false })
    const onRated = vi.fn()
    renderCard(onRated)

    await userEvent.type(screen.getByLabelText('Your answer'), 'It runs side effects after render')
    await userEvent.click(screen.getByRole('radio', { name: 'Fairly sure' }))
    await userEvent.click(screen.getByRole('button', { name: 'Check my answer' }))

    expect(mocked.respond).toHaveBeenCalledWith('b1', 'p1', { response: 'It runs side effects after render', confidence: 3 })
    expect(await screen.findByText('Yes — after render.')).toBeInTheDocument()
    expect(screen.getByText('Runs side effects after render.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Good' }))
    expect(mocked.rate).toHaveBeenCalledWith('log1', 'good')
    expect(onRated).toHaveBeenCalledWith({ rating: 'good', nextDueAt: '2026-09-04T09:00:00Z', nodeMastered: false })
    expect(await screen.findByText(/it will come back for spaced review/)).toBeInTheDocument()
  })

  it('only offers "continue" (rated again) after a wrong answer', async () => {
    mocked.respond.mockResolvedValue({
      logId: 'log2', correct: false, feedback: 'That describes props.', answerKey: 'k', gradingSource: 'misconception_bank', suggestedRating: 'again',
    })
    mocked.rate.mockResolvedValue({ nextDueAt: 'x', nodeMastered: false, unlockedBiteIds: [], teachingComplete: false })
    renderCard()
    await userEvent.type(screen.getByLabelText('Your answer'), 'props')
    await userEvent.click(screen.getByRole('radio', { name: 'Guessing' }))
    await userEvent.click(screen.getByRole('button', { name: 'Check my answer' }))
    await screen.findByText('That describes props.')
    expect(screen.queryByRole('button', { name: 'Good' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(mocked.rate).toHaveBeenCalledWith('log2', 'again')
  })

  it('shows a readable error instead of the raw failure', async () => {
    mocked.respond.mockRejectedValue(new Error('500 boom'))
    renderCard()
    await userEvent.type(screen.getByLabelText('Your answer'), 'x')
    await userEvent.click(screen.getByRole('radio', { name: 'Certain' }))
    await userEvent.click(screen.getByRole('button', { name: 'Check my answer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't grade that answer. Try again.")
  })
})

describe('CitationElement', () => {
  it('links real sources by title and domain', () => {
    render(<CitationElement citation={{ kind: 'grounded', sources: [{ url: 'https://react.dev/x', title: 'useEffect', domain: 'react.dev' }] }} />)
    expect(screen.getByRole('link', { name: /useEffect/ })).toHaveAttribute('href', 'https://react.dev/x')
  })

  it('shows a plain marker — never a link — for ungrounded content', () => {
    render(<CitationElement citation={{ kind: 'ungrounded', reason: 'low_risk' }} />)
    expect(screen.getByText('General knowledge, not source-grounded')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('FlagButton', () => {
  it('asks for an optional reason before sending the report', async () => {
    mocked.flag.mockResolvedValue({ flagId: 'f1' })
    render(
      <ToastProvider>
        <FlagButton biteId="b1" targetType="lesson_variant" targetId="v1" label="Report an issue with this explanation" />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Report an issue with this explanation' }))
    expect(mocked.flag).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText("What's wrong? (optional)"), 'Outdated API')
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(mocked.flag).toHaveBeenCalledWith('b1', { targetType: 'lesson_variant', targetId: 'v1', reason: 'Outdated API' })
    expect(await screen.findByText("Thanks, we'll look into it")).toBeInTheDocument()
  })
})
