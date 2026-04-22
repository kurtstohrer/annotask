/**
 * Zod schemas for the HTTP API and MCP tool boundaries.
 *
 * These are the single source of truth for the wire contract. The handlers in
 * api.ts / mcp/server.ts call `schema.safeParse()` and never touch raw bodies —
 * that keeps "strip unknown fields", "coerce types", and "reject bad shapes"
 * in one place instead of spread across hand-rolled checks.
 */
import { z } from 'zod'
import { TASK_TYPES } from '../schema.js'
import { SAFE_SCREENSHOT_RE, VALID_TASK_STATUSES, VALID_TRANSITIONS } from './validation.js'

const statusValues = [...VALID_TASK_STATUSES] as [string, ...string[]]
const statusError = `Invalid status. Must be one of: ${statusValues.join(', ')}`

type TaskTypeValue = typeof TASK_TYPES[number]
const typeValues = [...TASK_TYPES] as [TaskTypeValue, ...TaskTypeValue[]]
const typeError = `Invalid task type. Must be one of: ${typeValues.join(', ')}`

/** A screenshot filename that's safe to concatenate with a filesystem path. */
export const ScreenshotName = z.string().regex(SAFE_SCREENSHOT_RE, 'Invalid screenshot filename')

/**
 * A workspace-relative source path safe to read later. Rejects absolute
 * paths, URL-scheme prefixes, null-byte injection, UNC paths, and colons
 * (drive separators). `..` segments are intentionally permitted so tasks in
 * a monorepo can reference sibling workspace packages (e.g.
 * `../../packages/shared-ui-tokens/tokens.css`). Containment is enforced at
 * read time by `resolveProjectFile`, which pins the resolved absolute path
 * under the workspace root.
 */
export const SafeSourceFile = z
  .string()
  .min(1, 'file must be non-empty')
  .max(1024, 'file path too long')
  .refine(v => !/^[a-zA-Z]:[\\/]/.test(v), 'Absolute Windows paths are not allowed')
  .refine(v => !/^\\\\/.test(v), 'UNC paths are not allowed')
  .refine(v => !/^[a-z][a-z0-9+.-]*:\/\//i.test(v), 'URL-style paths are not allowed')
  .refine(v => !v.includes('\0'), 'Null bytes are not allowed')
  .refine(v => !v.includes(':'), 'Colons are not allowed in file paths')
  .refine(v => !/\/{2,}/.test(v.replace(/^\/+/, '')), 'File paths may not contain consecutive slashes')

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
  type: z.enum(typeValues, { message: typeError }),
  description: z.string().min(0, 'Missing required field: description (string)'),
  file: SafeSourceFile.optional(),
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
  data_context: z.unknown().optional(),
  screenshot: ScreenshotName.optional(),
  screenshot_meta: z.unknown().optional(),
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
  data_context: z.unknown().optional(),
  screenshot_meta: z.unknown().optional(),
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
  type: z.enum(typeValues, { message: typeError }),
  description: z.string().min(1, 'Missing required parameters: type, description'),
  file: SafeSourceFile.optional(),
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
  library: z.string().optional(),
  category: z.string().optional(),
  used_only: z.boolean().optional(),
  detail: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
})

export const McpGetComponentArgs = z.object({
  name: z.string().min(1, 'Missing required parameter: name'),
  library: z.string().optional(),
})

export const McpGetScreenshotArgs = z.object({
  task_id: z.string().min(1, 'Missing required parameter: task_id'),
})

export const McpGetCodeContextArgs = z.object({
  task_id: z.string().min(1, 'Missing required parameter: task_id'),
  context_lines: z.number().int().min(0).max(200).optional(),
})

export const McpGetComponentExamplesArgs = z.object({
  name: z.string().min(1, 'Missing required parameter: name'),
  limit: z.number().int().min(1).max(10).optional(),
  /** Optional library filter (e.g. `@mantine/core`, `radix-vue`). Prevents
   *  same-name components from different libraries from cross-contaminating
   *  the returned examples. */
  library: z.string().min(1).optional(),
})

export const McpGetDataContextArgs = z.object({
  task_id: z.string().min(1, 'Missing required parameter: task_id'),
  refresh: z.boolean().optional(),
})

export const McpGetInteractionHistoryArgs = z.object({
  task_id: z.string().min(1, 'Missing required parameter: task_id'),
})

export const McpGetRenderedHtmlArgs = z.object({
  task_id: z.string().min(1, 'Missing required parameter: task_id'),
})

const DataSourceKindEnum = z.enum(['composable', 'signal', 'store', 'fetch', 'graphql', 'loader', 'rpc'])

export const McpGetDataSourcesArgs = z.object({
  kind: DataSourceKindEnum.optional(),
  library: z.string().optional(),
  search: z.string().optional(),
  used_only: z.boolean().optional(),
  /** When true (the default), orphan runtime-observed endpoints are promoted into project_entries with `discovered_by: 'runtime'`. Set false for a pure static-scan view. */
  merge_runtime: z.boolean().optional(),
})

export const McpGetDataSourceExamplesArgs = z.object({
  name: z.string().min(1, 'Missing required parameter: name'),
  kind: DataSourceKindEnum.optional(),
  limit: z.number().int().min(1).max(10).optional(),
})

export const McpGetDataSourceDetailsArgs = z.object({
  name: z.string().min(1, 'Missing required parameter: name'),
  kind: DataSourceKindEnum.optional(),
  file: SafeSourceFile.optional(),
  context_lines: z.number().int().min(0).max(40).optional(),
})

export const McpGetApiSchemasArgs = z.object({
  kind: z.enum(['openapi', 'graphql', 'trpc', 'jsonschema']).optional(),
  detail: z.boolean().optional(),
})

export const McpGetApiOperationArgs = z.object({
  path: z.string().min(1, 'Missing required parameter: path'),
  method: z.string().optional(),
  schema_location: z.string().optional(),
})

export const McpResolveEndpointArgs = z.object({
  url: z.string().min(1, 'Missing required parameter: url'),
  method: z.string().optional(),
})

export const McpGetRuntimeEndpointsArgs = z.object({
  /** Filter to endpoints that have been hit at least once on this route. */
  route: z.string().optional(),
  /** Filter by HTTP method (GET/POST/...). */
  method: z.string().optional(),
  /** Substring match on pattern or concrete path (case-insensitive). */
  search: z.string().optional(),
  /** Only include endpoints with no matching static source — the "gaps" the regex scanner missed. */
  orphans_only: z.boolean().optional(),
  /** Include static-source and OpenAPI cross-references on each endpoint. Default true. */
  enrich: z.boolean().optional(),
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
