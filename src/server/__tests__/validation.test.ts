import { describe, it, expect } from 'vitest'
import {
  SAFE_SCREENSHOT_RE,
  isSafeScreenshot,
  VALID_TASK_STATUSES,
  VALID_TRANSITIONS,
  validateTransition,
  POSTABLE_TASK_FIELDS,
  PATCHABLE_TASK_FIELDS,
  pickFields,
  validateAgentFeedback,
} from '../validation'

describe('SAFE_SCREENSHOT_RE / isSafeScreenshot', () => {
  it('accepts the filenames the server produces', () => {
    expect(isSafeScreenshot('screenshot-1234567890-abcdef0123456789.png')).toBe(true)
    expect(isSafeScreenshot('x.png')).toBe(true)
    expect(isSafeScreenshot('under_score-and-dash.png')).toBe(true)
  })

  it('rejects path traversal and non-png inputs', () => {
    expect(isSafeScreenshot('../etc/passwd')).toBe(false)
    expect(isSafeScreenshot('../../secret.png')).toBe(false)
    expect(isSafeScreenshot('foo/bar.png')).toBe(false)
    expect(isSafeScreenshot('foo.PNG')).toBe(false) // case matters
    expect(isSafeScreenshot('foo.jpg')).toBe(false)
    expect(isSafeScreenshot('')).toBe(false)
    expect(isSafeScreenshot(undefined)).toBe(false)
    expect(isSafeScreenshot(null)).toBe(false)
    expect(isSafeScreenshot(42)).toBe(false)
  })

  it('regex and helper agree', () => {
    const cases = ['a.png', '../x.png', 'foo.txt', '']
    for (const c of cases) expect(isSafeScreenshot(c)).toBe(SAFE_SCREENSHOT_RE.test(c))
  })
})

describe('VALID_TRANSITIONS / validateTransition', () => {
  it('every transition target is itself a valid status', () => {
    for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
      expect(VALID_TASK_STATUSES.has(from)).toBe(true)
      for (const to of targets) {
        expect(VALID_TASK_STATUSES.has(to)).toBe(true)
      }
    }
  })

  it('allows pending → in_progress and rejects pending → accepted', () => {
    expect(validateTransition('pending', 'in_progress')).toBeNull()
    expect(validateTransition('pending', 'accepted')).toMatch(/Invalid state transition/)
  })

  it('allows review → accepted and review → denied', () => {
    expect(validateTransition('review', 'accepted')).toBeNull()
    expect(validateTransition('review', 'denied')).toBeNull()
  })

  it('returns null for unknown current status (legacy compat)', () => {
    expect(validateTransition('unknown', 'in_progress')).toBeNull()
  })
})

describe('pickFields', () => {
  it('keeps only whitelisted fields', () => {
    const body = { type: 'annotation', description: 'hi', id: 'x', status: 'pending', evil: true }
    const out = pickFields(body, POSTABLE_TASK_FIELDS)
    expect(out).toEqual({ type: 'annotation', description: 'hi' })
  })

  it('patch whitelist excludes id / type', () => {
    const out = pickFields({ status: 'review', id: 'x', type: 'annotation', description: 'ok' }, PATCHABLE_TASK_FIELDS)
    expect(out).toEqual({ status: 'review', description: 'ok' })
  })

  it('POSTABLE and PATCHABLE are disjoint on server-controlled fields', () => {
    for (const forbidden of ['id', 'createdAt', 'updatedAt']) {
      expect(POSTABLE_TASK_FIELDS.has(forbidden)).toBe(false)
      expect(PATCHABLE_TASK_FIELDS.has(forbidden)).toBe(false)
    }
  })
})

describe('validateAgentFeedback', () => {
  const baseQuestion = { id: 'q1', text: 'why?', type: 'text' as const }
  const goodEntry = { asked_at: 1, questions: [baseQuestion] }

  it('accepts a well-formed entry', () => {
    expect(validateAgentFeedback([goodEntry])).toBeNull()
  })

  it('requires an array at the top level', () => {
    expect(validateAgentFeedback({})).toMatch(/must be an array/)
  })

  it('requires asked_at as number', () => {
    expect(validateAgentFeedback([{ asked_at: 'now', questions: [baseQuestion] }])).toMatch(/asked_at/)
  })

  it('requires non-empty questions', () => {
    expect(validateAgentFeedback([{ asked_at: 1, questions: [] }])).toMatch(/non-empty/)
  })

  it('requires id + text per question', () => {
    expect(validateAgentFeedback([{ asked_at: 1, questions: [{ id: 1, text: 'hi', type: 'text' }] }])).toMatch(/id \(string\)/)
  })

  it('requires choice questions to have non-empty options', () => {
    expect(validateAgentFeedback([{ asked_at: 1, questions: [{ id: 'q', text: 'pick', type: 'choice' }] }])).toMatch(/non-empty options/)
    expect(validateAgentFeedback([{ asked_at: 1, questions: [{ id: 'q', text: 'pick', type: 'choice', options: ['a'] }] }])).toBeNull()
  })

  it('rejects bad question types', () => {
    expect(validateAgentFeedback([{ asked_at: 1, questions: [{ id: 'q', text: 'hi', type: 'dropdown' }] }])).toMatch(/text.*choice/)
  })

  it('validates answers structure when present', () => {
    expect(validateAgentFeedback([{ ...goodEntry, answers: 'nope' }])).toMatch(/answers must be an array/)
    expect(validateAgentFeedback([{ ...goodEntry, answers: [{ id: 'a' }] }])).toMatch(/value \(string\)/)
    expect(validateAgentFeedback([{ ...goodEntry, answers: [{ id: 'a', value: 'b' }] }])).toBeNull()
  })
})
