import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, IconButton } from './Button'
import { ProgressBar } from './ProgressBar'
import { StatusBadge } from './StatusBadge'
import { SegmentedToggle } from './SegmentedToggle'

describe('ui primitives', () => {
  it('disables the button and marks it busy while loading', () => {
    render(<Button loading>Submit</Button>)
    const button = screen.getByRole('button', { name: 'Submit' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('gives icon-only buttons an accessible label', () => {
    render(
      <IconButton label="Report an issue">
        <span>!</span>
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: 'Report an issue' })).toBeInTheDocument()
  })

  it('clamps progress and exposes it to assistive tech', () => {
    render(<ProgressBar value={140} label="React progress" />)
    expect(screen.getByRole('progressbar', { name: 'React progress' })).toHaveAttribute('aria-valuenow', '100')
  })

  it('renders a text label with every status, not color alone', () => {
    render(<StatusBadge status="mastered" />)
    expect(screen.getByText('Mastered')).toBeInTheDocument()
  })

  it('reports the selected option from the segmented toggle', async () => {
    const onChange = vi.fn()
    render(
      <SegmentedToggle
        label="Left panel"
        value="explanation"
        onChange={onChange}
        options={[
          { value: 'explanation', label: 'Explanation' },
          { value: 'chat', label: 'Ask a question' },
        ]}
      />,
    )
    expect(screen.getByRole('tab', { name: 'Explanation' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Ask a question' }))
    expect(onChange).toHaveBeenCalledWith('chat')
  })
})
