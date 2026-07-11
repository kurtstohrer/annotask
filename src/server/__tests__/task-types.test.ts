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

describe('wireframe_apply context validation (D2)', () => {
  // The live-mount "Build this route" path legitimately POSTs this shape.
  const liveMountContext = {
    wireframe: {
      route: '/planets',
      instances: [{ id: 'i1', kind: 'component', anchor: { file: 'src/App.vue', line: 12 }, inserted: { tag: 'div' } }],
    },
  }
  const sessionContext = {
    session: { session_id: 's1', entries: [{ change: { type: 'wireframe_direction', op: 'move' } }] },
  }

  it('accepts a wireframe_apply task with no context', () => {
    expect(parseWith(CreateTaskBody, { type: 'wireframe_apply', description: 'x' }).ok).toBe(true)
  })

  it('accepts the well-formed live-mount wireframe context', () => {
    expect(parseWith(CreateTaskBody, { type: 'wireframe_apply', description: 'x', context: liveMountContext }).ok).toBe(true)
  })

  it('accepts a well-formed design-session context', () => {
    expect(parseWith(CreateTaskBody, { type: 'wireframe_apply', description: 'x', context: sessionContext }).ok).toBe(true)
  })

  it('rejects a non-object context on a wireframe_apply task', () => {
    const r = parseWith(CreateTaskBody, { type: 'wireframe_apply', description: 'x', context: 'hostile string' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/wireframe_apply context/)
  })

  it('rejects a wireframe_apply context whose instances is not an array', () => {
    expect(parseWith(CreateTaskBody, {
      type: 'wireframe_apply', description: 'x', context: { wireframe: { route: '/x', instances: 'nope' } },
    }).ok).toBe(false)
  })

  it('rejects a wireframe_apply context whose instances hold non-objects', () => {
    expect(parseWith(CreateTaskBody, {
      type: 'wireframe_apply', description: 'x', context: { wireframe: { route: '/x', instances: [42] } },
    }).ok).toBe(false)
  })

  it('does NOT constrain context on other task types', () => {
    // annotation/style/etc. carry a free-form context by design.
    expect(parseWith(CreateTaskBody, { type: 'annotation', description: 'x', context: 'anything' }).ok).toBe(true)
    expect(parseWith(CreateTaskBody, { type: 'style_update', description: 'x', context: { changes: [] } }).ok).toBe(true)
  })

  it('applies the same guard at the MCP create boundary', () => {
    expect(parseWith(McpCreateTaskArgs, { type: 'wireframe_apply', description: 'x', context: liveMountContext }).ok).toBe(true)
    expect(parseWith(McpCreateTaskArgs, {
      type: 'wireframe_apply', description: 'x', context: { wireframe: { route: '/x', instances: 'nope' } },
    }).ok).toBe(false)
  })
})

describe('buildTaskSummary type coverage', () => {
  it('does not throw for any canonical task type', () => {
    for (const type of TASK_TYPES) {
      expect(() => buildTaskSummary({ id: 't', type, description: 'x', status: 'pending' })).not.toThrow()
    }
  })

})
