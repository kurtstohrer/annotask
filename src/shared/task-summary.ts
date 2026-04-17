/**
 * Shared task helpers used by the CLI, HTTP API, and MCP server.
 */

const BASE_SUMMARY_FIELDS = [
  'id', 'type', 'status', 'description', 'file', 'line', 'component',
  'action', 'screenshot', 'mfe', 'route', 'feedback', 'blocked_reason', 'resolution',
] as const

/** Context fields to lift into the summary, by task type. */
const CONTEXT_FIELDS_BY_TYPE: Record<string, readonly string[]> = {
  perf_fix:     ['metric', 'value', 'unit', 'severity', 'category', 'findingId'],
  a11y_fix:     ['rule', 'impact', 'helpUrl'],
  error_fix:    ['level', 'occurrences', 'errorId'],
  theme_update: ['category', 'role', 'before', 'after', 'cssVar'],
}

/**
 * Build a compact task summary suitable for agent triage. Includes the
 * top-level fields plus a small set of type-specific context fields so
 * agents can sort/filter without a follow-up get_task call.
 */
export function buildTaskSummary(task: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  for (const key of BASE_SUMMARY_FIELDS) {
    const v = task[key]
    if (v !== undefined && v !== null) summary[key] = v
  }

  const ctx = task.context
  if (ctx && typeof ctx === 'object' && !Array.isArray(ctx)) {
    const ctxRecord = ctx as Record<string, unknown>
    const typeKey = typeof task.type === 'string' ? task.type : ''
    const contextFields = CONTEXT_FIELDS_BY_TYPE[typeKey]
    if (contextFields) {
      for (const k of contextFields) {
        const v = ctxRecord[k]
        if (v !== undefined && v !== null) summary[k] = v
      }
    }
    // For change-bundle tasks, surface a count instead of the full array
    if ((typeKey === 'style_update' || typeKey === 'class_update') && Array.isArray(ctxRecord.changes)) {
      summary.change_count = (ctxRecord.changes as unknown[]).length
    }
  }

  return summary
}

/**
 * Filter a task list by MFE. MFE-less tasks (e.g. page-wide perf/error/a11y
 * findings that aren't tied to a specific element) are always included so they
 * remain discoverable when an MFE filter is active.
 */
export function filterTasksByMfe<T extends { mfe?: unknown }>(tasks: T[], mfe: string): T[] {
  return tasks.filter(t => !t.mfe || t.mfe === mfe)
}

/** Strip the `visual` field from a task — it's only useful for the shell UI, not agents. */
export function stripTaskVisual(task: unknown): Record<string, unknown> {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return {}
  const { visual, ...rest } = task as Record<string, unknown>
  return rest
}

/**
 * Trim `agent_feedback` to the latest resolved exchange plus every unresolved
 * one. Keeps the thread agent-friendly without re-sending old answered
 * questions on every fetch.
 */
export function trimAgentFeedback(task: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(task.agent_feedback)) return task
  const feedback = task.agent_feedback as Array<{ answers?: unknown[] }>
  const resolved = feedback.filter(e => Array.isArray(e.answers) && e.answers.length > 0)
  const unresolved = feedback.filter(e => !Array.isArray(e.answers) || e.answers.length === 0)
  const trimmed = [...(resolved.length > 0 ? [resolved[resolved.length - 1]] : []), ...unresolved]
  return { ...task, agent_feedback: trimmed.length > 0 ? trimmed : undefined }
}

/**
 * Compact JSON serialization for agent-facing output: no indentation, and
 * strips null/undefined/empty arrays to keep token counts down. Matches the
 * MCP server's response encoding so the CLI can offer MCP-parity output.
 */
export function compactJson(data: unknown): string {
  return JSON.stringify(data, (_key, value) => {
    if (value === null || value === undefined) return undefined
    if (Array.isArray(value) && value.length === 0) return undefined
    return value
  })
}
