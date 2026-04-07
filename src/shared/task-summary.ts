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
