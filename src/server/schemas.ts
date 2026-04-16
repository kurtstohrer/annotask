/**
 * Zod schemas for the HTTP API and MCP tool boundaries.
 *
 * These are the single source of truth for the wire contract. The handlers in
 * api.ts / mcp/server.ts call `schema.safeParse()` and never touch raw bodies —
 * that keeps "strip unknown fields", "coerce types", and "reject bad shapes"
 * in one place instead of spread across hand-rolled checks.
 */
import { z } from 'zod'
import { SAFE_SCREENSHOT_RE, VALID_TASK_STATUSES, VALID_TRANSITIONS } from './validation.js'

const statusValues = [...VALID_TASK_STATUSES] as [string, ...string[]]
const statusError = `Invalid status. Must be one of: ${statusValues.join(', ')}`

/** A screenshot filename that's safe to concatenate with a filesystem path. */
export const ScreenshotName = z.string().regex(SAFE_SCREENSHOT_RE, 'Invalid screenshot filename')

/** One question asked of the user in an agent_feedback thread. */
const FeedbackQuestion = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    text: z.string(),
    type: z.literal('text'),
  }),
  z.object({
    id: z.string(),
    text: z.string(),
    type: z.literal('choice'),
    options: z.array(z.string()).min(1, 'Choice questions require non-empty options array'),
  }),
])

const FeedbackAnswer = z.object({
  id: z.string(),
  value: z.string(),
})

const FeedbackEntry = z.object({
  asked_at: z.number(),
  questions: z.array(FeedbackQuestion).min(1, 'agent_feedback entry requires non-empty questions array'),
  answers: z.array(FeedbackAnswer).optional(),
  message: z.string().optional(),
}).passthrough()

export const AgentFeedbackSchema = z.array(FeedbackEntry)

// ── HTTP: POST /tasks ────────────────────────────────────

/**
 * Create-task body. `.strip()` (zod default) drops unknown keys silently, matching
 * the previous `pickFields` behavior and letting older clients send extra keys
 * without breaking.
 */
export const CreateTaskBody = z.object({
  type: z.string().min(1, 'Missing required field: type (string)'),
  description: z.string().min(0, 'Missing required field: description (string)'),
  file: z.string().optional(),
  line: z.number().optional(),
  component: z.string().optional(),
  mfe: z.string().optional(),
  route: z.string().optional(),
  intent: z.unknown().optional(),
  action: z.unknown().optional(),
  context: z.unknown().optional(),
  viewport: z.unknown().optional(),
  color_scheme: z.unknown().optional(),
  interaction_history: z.unknown().optional(),
  element_context: z.unknown().optional(),
  screenshot: ScreenshotName.optional(),
  visual: z.unknown().optional(),
})

// ── HTTP: PATCH /tasks/:id ───────────────────────────────

export const UpdateTaskBody = z.object({
  status: z.enum(statusValues, { message: statusError }).optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  screenshot: ScreenshotName.optional(),
  feedback: z.string().optional(),
  intent: z.unknown().optional(),
  action: z.unknown().optional(),
  context: z.unknown().optional(),
  viewport: z.unknown().optional(),
  color_scheme: z.unknown().optional(),
  interaction_history: z.unknown().optional(),
  element_context: z.unknown().optional(),
  mfe: z.string().optional(),
  agent_feedback: AgentFeedbackSchema.optional(),
  blocked_reason: z.string().optional(),
  resolution: z.string().optional(),
})

// ── HTTP: POST /screenshots ──────────────────────────────

export const UploadScreenshotBody = z.object({
  data: z.string().regex(/^data:image\/png;base64,/, 'Invalid PNG data URL'),
})

// ── HTTP: POST /performance ──────────────────────────────

export const PerformanceSnapshotBody = z.unknown() // shape owned by the shell; validated there

// ── MCP tool argument schemas ────────────────────────────

export const McpGetTasksArgs = z.object({
  status: z.enum(statusValues, { message: statusError }).optional(),
  mfe: z.string().optional(),
  detail: z.boolean().optional(),
})

export const McpGetTaskArgs = z.object({
  task_id: z.string().min(1, 'Missing required parameter: task_id'),
})

export const McpUpdateTaskArgs = z.object({
  task_id: z.string().min(1, 'Missing required parameter: task_id'),
  status: z.enum(statusValues, { message: statusError }).optional(),
  resolution: z.string().optional(),
  feedback: z.string().optional(),
  blocked_reason: z.string().optional(),
  questions: z.array(FeedbackQuestion).optional(),
  question_context: z.string().optional(),
})

export const McpCreateTaskArgs = z.object({
  type: z.string().min(1, 'Missing required parameters: type, description'),
  description: z.string().min(1, 'Missing required parameters: type, description'),
  file: z.string().optional(),
  line: z.number().optional(),
  component: z.string().optional(),
  mfe: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
})

export const McpDeleteTaskArgs = z.object({
  task_id: z.string().min(1, 'Missing required parameter: task_id'),
})

export const McpGetDesignSpecArgs = z.object({
  category: z.enum(['colors', 'typography', 'spacing', 'borders', 'breakpoints', 'icons', 'components', 'framework']).optional(),
})

export const McpGetComponentsArgs = z.object({
  search: z.string().optional(),
})

export const McpGetScreenshotArgs = z.object({
  task_id: z.string().min(1, 'Missing required parameter: task_id'),
})

// ── Runtime helpers ──────────────────────────────────────

/** Reduce a zod error to a single short message for API responses. */
export function formatZodError(err: z.ZodError): string {
  const first = err.issues[0]
  if (!first) return 'Invalid request'
  const p = first.path.length > 0 ? `${first.path.join('.')}: ` : ''
  return `${p}${first.message}`
}

/**
 * Parse `data` with `schema` and return a tagged result. Consumers produce
 * their own error response (HTTP 400 / MCP isError) from `error`.
 */
export function parseWith<T extends z.ZodTypeAny>(schema: T, data: unknown): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const r = schema.safeParse(data)
  if (r.success) return { ok: true, data: r.data }
  return { ok: false, error: formatZodError(r.error) }
}

/** Convenience: validate a state transition with the same wording used by the HTTP API. */
export function assertTransition(from: unknown, to: unknown): string | null {
  const fromStr = String(from)
  const allowed = VALID_TRANSITIONS[fromStr]
  if (!allowed) return null
  if (!allowed.has(String(to))) return `Invalid state transition: ${fromStr} → ${to}. Allowed: ${[...allowed].join(', ')}`
  return null
}
