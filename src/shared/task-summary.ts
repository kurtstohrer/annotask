/**
 * Shared task helpers used by the CLI, HTTP API, and MCP server.
 */

import type { TaskType } from '../schema.js'

const BASE_SUMMARY_FIELDS = [
  'id', 'type', 'status', 'description', 'file', 'line', 'component',
  'action', 'screenshot', 'mfe', 'route', 'viewport', 'feedback',
  'blocked_reason', 'resolution',
] as const

/**
 * Context fields to lift into the summary, by task type. Partial — only task
 * types with type-specific context fields need entries. `annotation` and
 * `section_request` rely on LOCATOR_CONTEXT_FIELDS + top-level lifting instead.
 */
const CONTEXT_FIELDS_BY_TYPE: Partial<Record<TaskType, readonly string[]>> = {
  perf_fix:     ['metric', 'value', 'unit', 'severity', 'category', 'findingId'],
  a11y_fix:     ['rule', 'impact', 'helpUrl'],
  error_fix:    ['level', 'occurrences', 'errorId'],
  theme_update: ['category', 'role', 'before', 'after', 'cssVar'],
  style_update: [],
  api_update:   ['data_source_name', 'data_source_kind', 'schema_location', 'schema_kind', 'endpoint', 'desired_change'],
}

/**
 * Locator-ish context fields that help an agent triage without a follow-up
 * get_task call. Lifted for every task type that has them — they're cheap,
 * human-readable, and already on the task at creation time.
 */
const LOCATOR_CONTEXT_FIELDS = [
  'element_tag', 'element_classes', 'element_text',
  'selected_text',
  'from_element_tag', 'from_element_classes', 'from_element_text',
] as const

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

  // color_scheme is an object on the task; collapse to just the scheme string
  // for the summary (matches how stripTaskVisual compacts it for detail=true).
  if (task.color_scheme && typeof task.color_scheme === 'object' && !Array.isArray(task.color_scheme)) {
    const scheme = (task.color_scheme as Record<string, unknown>).scheme
    if (scheme !== undefined) summary.color_scheme = scheme
  }

  // Section-request tasks carry placement at the top level.
  if (task.type === 'section_request' && typeof task.placement === 'string' && task.placement) {
    summary.placement = task.placement
  }

  // Selected element text lives on element_context; surface it for quick triage.
  if (task.element_context && typeof task.element_context === 'object' && !Array.isArray(task.element_context)) {
    const text = (task.element_context as Record<string, unknown>).selected_element_text
    if (typeof text === 'string' && text) summary.selected_element_text = text
  }

  // Component info now lives at context.component. Lift its name/library so
  // triage sees what was selected without a detail fetch.
  if (task.context && typeof task.context === 'object' && !Array.isArray(task.context)) {
    const comp = (task.context as Record<string, unknown>).component
    if (comp && typeof comp === 'object' && !Array.isArray(comp)) {
      const c = comp as Record<string, unknown>
      if (typeof c.name === 'string' && c.name) summary.component_name = c.name
      if (typeof c.library === 'string' && c.library) summary.component_library = c.library
      if (typeof c.file === 'string' && c.file && c.file !== summary.file) summary.component_file = c.file
    }
  }

  // Retry signal — lets agents sort denied tasks by attempt count.
  if (Array.isArray(task.agent_feedback) && task.agent_feedback.length > 0) {
    summary.attempts = task.agent_feedback.length
  }

  // One-liner "kind:name" of the primary data source, when present. Lets the
  // agent spot data-driven tasks during triage without a detail fetch.
  // `sources[0]` is the resolver-selected primary (sorted nearest to task.line).
  if (task.data_context && typeof task.data_context === 'object' && !Array.isArray(task.data_context)) {
    const dc = task.data_context as {
      sources?: unknown
    }
    const primary = Array.isArray(dc.sources) && dc.sources.length > 0 && typeof dc.sources[0] === 'object' && dc.sources[0] !== null
      ? dc.sources[0] as { kind?: unknown; name?: unknown; response_schema_ref?: unknown; schema_in_repo?: unknown }
      : undefined
    const kind = primary?.kind
    const name = primary?.name
    if (typeof kind === 'string' && typeof name === 'string' && kind && name) {
      summary.data_context_summary = `${kind}:${name}`
    }
    // Surface the primary's matched schema ref (e.g. "Cat[]") so agents see
    // during triage which tasks have a known response shape. Also surface
    // in_repo so agents can filter internal-vs-external APIs without a
    // follow-up call — internal APIs are editable, external ones are fixed
    // contracts.
    if (typeof primary?.response_schema_ref === 'string' && primary.response_schema_ref) {
      summary.response_schema_ref = primary.response_schema_ref
      if (typeof primary.schema_in_repo === 'boolean') {
        summary.response_schema_in_repo = primary.schema_in_repo
      }
    }
  }

  const ctx = task.context
  if (ctx && typeof ctx === 'object' && !Array.isArray(ctx)) {
    const ctxRecord = ctx as Record<string, unknown>
    const typeKey = typeof task.type === 'string' ? task.type : ''
    const contextFields = CONTEXT_FIELDS_BY_TYPE[typeKey as TaskType]
    if (contextFields) {
      for (const k of contextFields) {
        const v = ctxRecord[k]
        if (v !== undefined && v !== null) summary[k] = v
      }
    }
    // Locator fields apply across all task types that happen to carry them.
    for (const k of LOCATOR_CONTEXT_FIELDS) {
      const v = ctxRecord[k]
      if (typeof v === 'string' && v) summary[k] = v
    }
    // Arrow tasks: surface a compact to_element pointer (tag + file + line).
    if (ctxRecord.to_element && typeof ctxRecord.to_element === 'object' && !Array.isArray(ctxRecord.to_element)) {
      const t = ctxRecord.to_element as Record<string, unknown>
      const compact: Record<string, unknown> = {}
      if (typeof t.tag === 'string' && t.tag) compact.tag = t.tag
      if (typeof t.file === 'string' && t.file) compact.file = t.file
      if (typeof t.line === 'number' && t.line) compact.line = t.line
      if (Object.keys(compact).length > 0) summary.to_element = compact
    }
    // For change-bundle tasks, surface a count instead of the full array
    if ((typeKey === 'style_update' || typeKey === 'class_update') && Array.isArray(ctxRecord.changes)) {
      summary.change_count = (ctxRecord.changes as unknown[]).length
    }
    // api_update tasks: lift the nested operation pointer so triage sees
    // method + path without a detail fetch.
    if (typeKey === 'api_update' && ctxRecord.operation && typeof ctxRecord.operation === 'object' && !Array.isArray(ctxRecord.operation)) {
      const op = ctxRecord.operation as Record<string, unknown>
      if (typeof op.method === 'string' && op.method) summary.operation_method = op.method
      if (typeof op.path === 'string' && op.path) summary.operation_path = op.path
    }
    // Any task that recorded cross-boundary API edits (commonly annotations
    // that the user approved into backend territory) — surface the count so
    // triage sees that this task crossed the frontend/backend line.
    if (Array.isArray(ctxRecord.api_edits) && ctxRecord.api_edits.length > 0) {
      summary.api_edits_count = ctxRecord.api_edits.length
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

/**
 * Strip or compact fields that are only useful for the shell UI, not agents:
 * - drops `visual` and the `createdAt`/`updatedAt` timestamps
 * - collapses `color_scheme` to just `{ scheme }` — the marker/source metadata
 *   is UI-only (how the shell detected dark/light); agents can consult the
 *   design spec if they need more.
 */
export function stripTaskVisual(task: unknown): Record<string, unknown> {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return {}
  const { visual, createdAt, updatedAt, color_scheme, ...rest } = task as Record<string, unknown>
  if (color_scheme && typeof color_scheme === 'object' && !Array.isArray(color_scheme)) {
    const scheme = (color_scheme as Record<string, unknown>).scheme
    if (scheme !== undefined) rest.color_scheme = scheme
  }
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
