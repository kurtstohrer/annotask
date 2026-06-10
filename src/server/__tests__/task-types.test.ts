import { describe, it, expect } from 'vitest'
import { TASK_TYPES } from '../../schema'
import { CreateTaskBody, McpCreateTaskArgs, parseWith } from '../schemas'
import { buildTaskSummary } from '../../shared/task-summary'

describe('TASK_TYPES enforcement', () => {
  it('exposes the full canonical list', () => {
    expect([...TASK_TYPES]).toEqual([
      'annotation',
      'section_request',
      'style_update',
      'theme_update',
      'a11y_fix',
      'error_fix',
      'perf_fix',
      'wireframe_apply',
    ])
  })

  it('HTTP CreateTaskBody accepts every canonical type', () => {
    for (const type of TASK_TYPES) {
      const result = parseWith(CreateTaskBody, { type, description: 'x' })
      expect(result.ok, `type=${type}`).toBe(true)
    }
  })

  it('HTTP CreateTaskBody rejects unknown types', () => {
    const result = parseWith(CreateTaskBody, { type: 'bogus', description: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/task type/i)
  })

  it('MCP McpCreateTaskArgs accepts every canonical type', () => {
    for (const type of TASK_TYPES) {
      const result = parseWith(McpCreateTaskArgs, { type, description: 'x' })
      expect(result.ok, `type=${type}`).toBe(true)
    }
  })

  it('MCP McpCreateTaskArgs rejects unknown types', () => {
    const result = parseWith(McpCreateTaskArgs, { type: 'bogus', description: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/task type/i)
  })
})

describe('buildTaskSummary type coverage', () => {
  it('does not throw for any canonical task type', () => {
    for (const type of TASK_TYPES) {
      expect(() => buildTaskSummary({ id: 't', type, description: 'x', status: 'pending' })).not.toThrow()
    }
  })

})
