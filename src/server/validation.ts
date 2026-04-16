/**
 * Canonical validation rules for task mutations.
 * Single source of truth for the HTTP API, the MCP server, and the state layer.
 */

/** Screenshot filenames must be alphanumeric/underscore/dash + .png — no path separators. */
export const SAFE_SCREENSHOT_RE = /^[a-zA-Z0-9_-]+\.png$/

export function isSafeScreenshot(name: unknown): name is string {
  return typeof name === 'string' && SAFE_SCREENSHOT_RE.test(name)
}

/** Every status a task can legally hold. */
export const VALID_TASK_STATUSES = new Set([
  'pending', 'in_progress', 'applied', 'review', 'accepted', 'denied', 'needs_info', 'blocked',
])

/** From `current` → allowed `next`. Rejects silent-overwrite transitions. */
export const VALID_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  pending:     new Set(['in_progress', 'denied']),
  in_progress: new Set(['applied', 'review', 'needs_info', 'blocked', 'denied']),
  applied:     new Set(['review', 'in_progress']),
  review:      new Set(['accepted', 'denied', 'in_progress']),
  needs_info:  new Set(['in_progress', 'denied']),
  blocked:     new Set(['in_progress', 'denied']),
  denied:      new Set(['pending', 'in_progress']),
}

/** Returns null if the transition is allowed, otherwise a reason string for the API to return as 400. */
export function validateTransition(current: unknown, next: unknown): string | null {
  const from = String(current)
  const to = String(next)
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed) return null // unknown current state — don't block (e.g. legacy task)
  if (!allowed.has(to)) return `Invalid state transition: ${from} → ${to}. Allowed: ${[...allowed].join(', ')}`
  return null
}

/** Fields that POST /tasks is allowed to set (server controls id, status, timestamps). */
export const POSTABLE_TASK_FIELDS: ReadonlySet<string> = new Set([
  'type', 'description', 'file', 'line', 'component', 'mfe', 'route',
  'intent', 'action', 'context', 'viewport', 'color_scheme', 'interaction_history',
  'element_context', 'screenshot', 'visual',
])

/** Fields that PATCH /tasks/:id is allowed to update. */
export const PATCHABLE_TASK_FIELDS: ReadonlySet<string> = new Set([
  'status', 'description', 'notes', 'screenshot', 'feedback',
  'intent', 'action', 'context', 'viewport', 'color_scheme', 'interaction_history',
  'element_context', 'mfe', 'agent_feedback', 'blocked_reason', 'resolution',
])

/** Keep only whitelisted keys from `body`. */
export function pickFields(body: Record<string, unknown>, allowed: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(body)) {
    if (allowed.has(key)) out[key] = body[key]
  }
  return out
}

/** Validate the shape of an agent_feedback array. Returns null on success, reason string on failure. */
export function validateAgentFeedback(value: unknown): string | null {
  if (!Array.isArray(value)) return 'agent_feedback must be an array'
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return 'agent_feedback entries must be objects'
    const e = entry as Record<string, unknown>
    if (typeof e.asked_at !== 'number') return 'agent_feedback entry requires asked_at (number)'
    if (!Array.isArray(e.questions) || e.questions.length === 0) return 'agent_feedback entry requires non-empty questions array'
    for (const q of e.questions as unknown[]) {
      if (!q || typeof q !== 'object') return 'Each question must be an object'
      const qq = q as Record<string, unknown>
      if (typeof qq.id !== 'string' || typeof qq.text !== 'string') return 'Each question requires id (string) and text (string)'
      if (qq.type !== 'text' && qq.type !== 'choice') return 'Question type must be "text" or "choice"'
      if (qq.type === 'choice' && (!Array.isArray(qq.options) || qq.options.length === 0)) return 'Choice questions require non-empty options array'
    }
    if (e.answers !== undefined) {
      if (!Array.isArray(e.answers)) return 'answers must be an array'
      for (const a of e.answers as unknown[]) {
        if (!a || typeof a !== 'object') return 'Each answer must be an object'
        const aa = a as Record<string, unknown>
        if (typeof aa.id !== 'string' || typeof aa.value !== 'string') return 'Each answer requires id (string) and value (string)'
      }
    }
  }
  return null
}
