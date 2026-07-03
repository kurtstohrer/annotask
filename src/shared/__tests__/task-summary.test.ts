import { describe, it, expect } from 'vitest'
import { buildTaskSummary } from '../task-summary'

describe('buildTaskSummary — fragment_url surfacing', () => {
  it('lifts context.fragment_url into the summary for annotation tasks', () => {
    const summary = buildTaskSummary({
      id: 't1',
      type: 'annotation',
      status: 'pending',
      description: 'Make the result rows denser',
      file: '',
      line: 0,
      context: { element_tag: 'li', fragment_url: 'POST /search' },
    })
    expect(summary.fragment_url).toBe('POST /search')
    // Locator fields lift alongside it, unchanged.
    expect(summary.element_tag).toBe('li')
  })

  it('omits fragment_url when the context does not carry it', () => {
    const summary = buildTaskSummary({
      id: 't2',
      type: 'annotation',
      status: 'pending',
      description: 'Tweak heading',
      file: 'src/App.vue',
      line: 12,
      context: { element_tag: 'h1' },
    })
    expect('fragment_url' in summary).toBe(false)
  })

  it('ignores a non-string fragment_url (locator fields are string-only)', () => {
    const summary = buildTaskSummary({
      id: 't3',
      type: 'annotation',
      status: 'pending',
      description: 'x',
      context: { fragment_url: 42 },
    })
    expect('fragment_url' in summary).toBe(false)
  })

  it('lifts fragment_url for any task type that happens to carry it', () => {
    const summary = buildTaskSummary({
      id: 't4',
      type: 'a11y_fix',
      status: 'pending',
      description: 'contrast',
      context: { rule: 'color-contrast', fragment_url: 'GET /rows' },
    })
    expect(summary.fragment_url).toBe('GET /rows')
    expect(summary.rule).toBe('color-contrast')
  })
})
