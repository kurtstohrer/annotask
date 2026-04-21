import type { IncomingMessage, ServerResponse } from 'node:http'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'
import { isLocalOrigin } from '../server/origin.js'
import { scanComponentLibraries } from '../server/component-scanner.js'
import { buildTaskSummary, filterTasksByMfe, stripTaskVisual, trimAgentFeedback, compactJson } from '../shared/task-summary.js'
import { isSafeScreenshot } from '../server/validation.js'
import { getCodeContext } from '../server/code-context.js'
import { getComponentExamples } from '../server/component-examples.js'
import { resolveDataContext } from '../server/data-context.js'
import { scanDataSources } from '../server/data-source-scanner.js'
import { getDataSourceExamples } from '../server/data-source-examples.js'
import { resolveDataSourceDetails } from '../server/data-source-details.js'
import { scanApiSchemas } from '../server/api-schema-scanner.js'
import { resolveEndpoint } from '../server/api-schema-resolver.js'
import { resolveWorkspace } from '../server/workspace.js'
import { TASK_TYPES, type DataSource } from '../schema.js'

/** Monorepo root for containment checks, or `undefined` when the project is
 *  not inside a workspace. Cached via `resolveWorkspace`. */
async function getWorkspaceRoot(projectRoot: string): Promise<string | undefined> {
  try {
    const info = await resolveWorkspace(projectRoot)
    return info.isWorkspace ? info.root : undefined
  } catch {
    return undefined
  }
}
import {
  McpGetTasksArgs,
  McpGetTaskArgs,
  McpUpdateTaskArgs,
  McpCreateTaskArgs,
  McpDeleteTaskArgs,
  McpGetDesignSpecArgs,
  McpGetComponentsArgs,
  McpGetComponentArgs,
  McpGetScreenshotArgs,
  McpGetCodeContextArgs,
  McpGetComponentExamplesArgs,
  McpGetDataContextArgs,
  McpGetInteractionHistoryArgs,
  McpGetRenderedHtmlArgs,
  McpGetDataSourcesArgs,
  McpGetDataSourceExamplesArgs,
  McpGetDataSourceDetailsArgs,
  McpGetApiSchemasArgs,
  McpGetApiOperationArgs,
  McpResolveEndpointArgs,
  parseWith,
  assertTransition,
  AgentFeedbackSchema,
} from '../server/schemas.js'

// ── Types ────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
  id?: string | number | null
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
  id: string | number | null
}

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpDeps {
  projectRoot: string
  getDesignSpec: () => unknown
  getTasks: () => { version: string; tasks: Array<Record<string, unknown>> }
  addTask: (task: Record<string, unknown>) => unknown | Promise<unknown>
  updateTask: (id: string, updates: Record<string, unknown>) => unknown | Promise<unknown>
  deleteTask: (id: string) => unknown | Promise<unknown>
  readInteractionHistory: (taskId: string) => Promise<unknown | null>
  readRenderedHtml: (taskId: string) => Promise<string | null>
}

// ── Constants ────────────────────────────────────────

// Compact JSON + stripVisual + agent-feedback trimming are shared with the CLI
// so agents get identical output whether they hit the MCP endpoint directly or
// fall back to `npx annotask ... --mcp`.
const compact = compactJson
const stripVisual = stripTaskVisual

// Minimal shapes so we don't drag the full scanner types through the MCP layer.
interface ScannedComponentLike {
  name: string
  module: string
  description?: string | null
  category?: string | null
  tags?: string[]
  deprecated?: boolean
  props?: Array<{ name: string }>
  slots?: Array<{ name: string }>
  events?: Array<{ name: string }>
}
interface ScannedLibraryLike {
  name: string
  version?: string
  components?: ScannedComponentLike[]
}

/** Compact summary for an agent-facing component list — no props/slots/events bodies. */
function componentSummary(c: ScannedComponentLike) {
  return {
    name: c.name,
    module: c.module,
    category: c.category ?? null,
    description: c.description ?? null,
    propCount: c.props?.length ?? 0,
    slotCount: c.slots?.length ?? 0,
    eventCount: c.events?.length ?? 0,
    deprecated: c.deprecated ? true : undefined,
  }
}

const PROTOCOL_VERSION = '2025-03-26'
// Version is baked at build time from package.json so the MCP initialize response doesn't drift.
declare const __ANNOTASK_VERSION__: string | undefined
const SERVER_INFO = { name: 'annotask', version: typeof __ANNOTASK_VERSION__ === 'string' ? __ANNOTASK_VERSION__ : '0.0.0' }

// ── Tool definitions ─────────────────────────────────

const TOOLS: ToolDef[] = [
  {
    name: 'annotask_get_tasks',
    description:
      'Get design tasks from Annotask. Returns task summaries by default (id, type, status, description, file, line, action, screenshot). ' +
      'Use detail=true for full objects including context, viewport, and interaction_history. ' +
      'Use annotask_get_task to fetch full detail for a single task. ' +
      'Focus on "pending" and "denied" (with feedback) tasks for work to do.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter tasks by status',
          enum: ['pending', 'in_progress', 'applied', 'review', 'denied', 'needs_info', 'blocked'],
        },
        mfe: {
          type: 'string',
          description: 'Filter by micro-frontend identity (e.g. "@myorg/my-mfe")',
        },
        detail: {
          type: 'boolean',
          description: 'If true, return full task objects. Default false returns summaries.',
        },
      },
    },
  },
  {
    name: 'annotask_get_task',
    description:
      'Get full details for a single task by ID. Returns all fields including context, interaction_history, and agent_feedback. ' +
      'Use this after reviewing the task summary list to get full context for a specific task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task ID to fetch' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'annotask_update_task',
    description:
      'Update a task status or fields. Common workflows:\n' +
      '- Lock before working: status→"in_progress"\n' +
      '- Mark applied: status→"review" + resolution note\n' +
      '- Ask user questions: provide questions array (auto-sets status→"needs_info")\n' +
      '- Mark blocked: provide blocked_reason (auto-sets status→"blocked")\n' +
      'Valid transitions: pending→in_progress|denied, in_progress→review|needs_info|blocked|denied, review→accepted|denied|in_progress, needs_info→in_progress|denied, blocked→in_progress|denied, denied→pending|in_progress.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task ID to update' },
        status: {
          type: 'string',
          description: 'New status for the task',
          enum: ['pending', 'in_progress', 'applied', 'review', 'accepted', 'denied', 'needs_info', 'blocked'],
        },
        resolution: { type: 'string', description: 'Brief note on what was changed (use when marking review)' },
        feedback: { type: 'string', description: 'Denial notes from reviewer' },
        blocked_reason: { type: 'string', description: 'Why the task cannot be applied (markdown). Auto-sets status to "blocked" if no status given.' },
        questions: {
          type: 'array',
          description: 'Ask the user clarifying questions. Auto-sets status to "needs_info" if no status given.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique question ID (e.g. "q1")' },
              text: { type: 'string', description: 'The question text' },
              type: { type: 'string', enum: ['text', 'choice'], description: '"text" for free-text, "choice" for multiple choice' },
              options: { type: 'array', items: { type: 'string' }, description: 'Choices (required when type is "choice")' },
            },
            required: ['id', 'text', 'type'],
          },
        },
        question_context: { type: 'string', description: 'Optional markdown context to accompany questions' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'annotask_create_task',
    description: `Create a new design task with "pending" status. Types: ${TASK_TYPES.join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Task type' },
        description: { type: 'string', description: 'What needs to be done (markdown)' },
        file: { type: 'string', description: 'Source file path' },
        line: { type: 'number', description: 'Line number in file' },
        component: { type: 'string', description: 'Component name' },
        mfe: { type: 'string', description: 'MFE identity (e.g. "@myorg/my-mfe") for multi-project setups' },
        context: { type: 'object', description: 'Arbitrary context data' },
      },
      required: ['type', 'description'],
    },
  },
  {
    name: 'annotask_delete_task',
    description: 'Permanently delete a task and its associated screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task ID to delete' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'annotask_get_design_spec',
    description:
      'Get the project design specification. Without a category, returns a summary (framework info, token counts). ' +
      'With a category, returns full tokens for that category. Generated by /annotask-init.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Return only this category. Omit for a summary overview.',
          enum: ['colors', 'typography', 'spacing', 'borders', 'breakpoints', 'icons', 'components', 'framework'],
        },
      },
    },
  },
  {
    name: 'annotask_get_components',
    description:
      'Search component libraries detected in node_modules. By default returns compact summaries (name, module, category) — set detail=true for full props/slots/events/description. ' +
      'Filters: `search` (name substring), `library` (exact library name), `category` (e.g. "button", "form"), `used_only` (restrict to components actually imported in this codebase — highest-signal filter). ' +
      'Paginate with `limit` (default 50, max 500) and `offset`. For a single component use annotask_get_component.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Filter components by name (case-insensitive substring match)' },
        library: { type: 'string', description: 'Exact library name (e.g. "primevue")' },
        category: { type: 'string', description: 'Category filter (e.g. "button", "form", "overlay", "data", "layout")' },
        used_only: { type: 'boolean', description: 'Return only components that are actually imported in the codebase (from design-spec.components.used)' },
        detail: { type: 'boolean', description: 'Include full props, slots, events, and description. Default false returns compact summaries.' },
        limit: { type: 'number', description: 'Max results per library. Default 50, max 500.' },
        offset: { type: 'number', description: 'Skip the first N results (pagination). Default 0.' },
      },
    },
  },
  {
    name: 'annotask_get_component',
    description:
      'Get full detail for a single component by name: props, slots, events, description, category, import module. ' +
      'Use after annotask_get_components identifies candidates. Provide `library` to disambiguate when the same name exists in multiple libraries.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Component name (e.g. "Button", "DataTable")' },
        library: { type: 'string', description: 'Library name to disambiguate (e.g. "primevue")' },
      },
      required: ['name'],
    },
  },
  {
    name: 'annotask_get_screenshot',
    description: 'Get a task screenshot as a base64-encoded PNG image. Screenshots show what the user sees in the browser, providing visual context for what change is needed.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task ID whose screenshot to fetch' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'annotask_get_code_context',
    description:
      'Resolve a task to grounded source context: a ±15 line excerpt around `task.line`, the nearest enclosing symbol/component, the file\'s import block, and a short `excerpt_hash` for drift detection. ' +
      'Prefer this over trusting `task.line` when a task has been retried, is older than your current triage pass, or when a prior Edit touched the same file. ' +
      'Use `context_lines` to widen/narrow the window (default 15, max 200).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task ID to resolve source context for' },
        context_lines: { type: 'number', description: 'Lines of context on each side of task.line. Default 15, max 200.' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'annotask_get_component_examples',
    description:
      'Find real in-repo usages of a component by name. Returns up to `limit` call sites (default 3) with a short surrounding source snippet, the line number, and the most common import path for the component. ' +
      'Use this when you are about to reuse or place a component and want to match the repo\'s own conventions (prop combinations, wrapper patterns, slot usage) rather than invent new ones.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Component name to search for (case-sensitive)' },
        limit: { type: 'number', description: 'Max examples to return. Default 3, max 10.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'annotask_get_interaction_history',
    description:
      'Retrieve the user\'s pre-task interaction trace: navigation path plus the last ~20 recorded actions (clicks, form submits, route changes) as of task creation. ' +
      'Always captured server-side — the per-task "Embed interaction history" toggle only decides whether this data rides in the task payload, so use this tool whenever an annotation references a flow or sequence ("after I click submit…", "on the orders page…") and the payload itself lacks `interaction_history`. ' +
      'Returns the stored snapshot (or the embedded copy when the user opted in). If nothing was captured (e.g. task came from an external API caller), the response has `not_captured: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task ID whose interaction history to fetch' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'annotask_get_rendered_html',
    description:
      'Fetch the `outerHTML` of the element the task was attached to, captured post-render at task creation (React/Vue bindings resolved, annotask attrs stripped). ' +
      'Always captured when a selection existed — the "Embed rendered HTML" toggle only gates embedding in the task payload. Use this when the task description references visual structure that is hard to reconstruct from source alone ("the three spans in the header", "this button\'s icon wrapper") or when you need to match existing inline markup for a style fix. ' +
      'Response shape: `{ task_id, rendered, source }` where `source` is `"embedded"` (read from the task payload) or `"sidecar"` (loaded from the per-task store). `{ rendered: null, not_captured: true }` when no snapshot exists. Hard-capped at 200 KB per task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task ID whose rendered HTML to fetch' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'annotask_get_data_context',
    description:
      'Resolve (or return stored) data_context for a task — what hooks/stores/fetch calls power the selected element. ' +
      'Returns `sources[]` — every data reference in the enclosing file, sorted with the primary (nearest to `task.line`, tie-broken hook>store>fetch>graphql>loader>rpc) at index 0 — plus `rendered_identifiers` (template/JSX names, CSV) and `route_bindings` (route params/query keys, CSV). ' +
      'Use this before editing or inserting any data-driven UI so you reuse the repo\'s own queries/stores instead of writing fake data. Pass `refresh: true` to force a fresh scan even if the task already stores a data_context.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task ID to resolve data context for' },
        refresh: { type: 'boolean', description: 'Ignore stored data_context on the task and re-scan the source file.' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'annotask_get_data_sources',
    description:
      'List the project-wide data source catalog: detected data-fetching libraries from package.json (React Query, SWR, Pinia, Zustand, Apollo, tRPC, …) and project-specific entries found in `src/` (user hooks, stores, fetch wrappers, GraphQL operations). ' +
      '`project_entries` come sorted by `used_count` descending — the most load-bearing entries first. Use this when deciding which existing data source to reuse before writing new code.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['composable', 'signal', 'store', 'fetch', 'graphql', 'loader', 'rpc'], description: 'Only return project entries of this kind. "composable" covers React hooks, Vue composables, Svelte helpers, Solid primitive wrappers. "signal" is fine-grained reactive (Solid createSignal, Svelte store reads).' },
        library: { type: 'string', description: 'Only return this library from the libraries list.' },
        search: { type: 'string', description: 'Substring match on project entry name (case-insensitive).' },
        used_only: { type: 'boolean', description: 'Restrict project entries to `used_count > 0` — analogous to `annotask_get_components` used_only filter.' },
      },
    },
  },
  {
    name: 'annotask_get_api_schemas',
    description:
      'List discovered API schemas. Sources: OpenAPI/Swagger JSON/YAML files, GraphQL SDL files, tRPC routers (with zod input/output), and live dev-server probes at common paths (/openapi.json, /graphql with introspection, etc.). ' +
      'Default returns compact entries (kind, location, title, operation_count). Set detail=true to include every `operations[]` with full request/response schemas. ' +
      'Use alongside `annotask_get_data_context` — when a source has `response_schema_ref`, this tool lets you pull the full shape.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['openapi', 'graphql', 'trpc', 'jsonschema'], description: 'Filter by schema kind.' },
        detail: { type: 'boolean', description: 'Include full operations[] array. Default false — agents usually fetch by operation via annotask_get_api_operation.' },
      },
    },
  },
  {
    name: 'annotask_get_api_operation',
    description:
      'Fetch a single operation by path (+ optional method). Returns the operation with `request_schema`, `response_schema`, `schema_refs` (named types to chase via further calls), and a `schema_location` pointer. ' +
      'Use this after `annotask_get_data_context` surfaces a `response_schema_ref`, or after `annotask_resolve_endpoint` returns a match.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Operation path pattern (OpenAPI: "/users/{id}"; GraphQL: field name like "users"; tRPC: procedure name "users.list").' },
        method: { type: 'string', description: 'HTTP method for OpenAPI (GET/POST/...), or "query"/"mutation"/"subscription" for GraphQL, or "query"/"mutation" for tRPC.' },
        schema_location: { type: 'string', description: 'Disambiguate when the same path exists in multiple discovered schemas — use the `location` from annotask_get_api_schemas.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'annotask_resolve_endpoint',
    description:
      'Resolve a concrete URL (e.g. `/api/users/42`) against the discovered OpenAPI / GraphQL / tRPC schemas — returns the best-match operation with a confidence score. ' +
      'Call this when `data_context` surfaces an endpoint and you want to know its declared response shape. Complementary to `annotask_get_api_operation`: use this when you have a URL, use `annotask_get_api_operation` when you have a path pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Concrete URL or path. Query strings / fragments are stripped.' },
        method: { type: 'string', description: 'HTTP method — improves match score when provided.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'annotask_get_data_source_examples',
    description:
      'Find in-repo usages of a data source by name — symmetric with `annotask_get_component_examples`. Returns up to `limit` call sites (default 3) with ±5 lines of surrounding code and the dominant import path. ' +
      'Use this after identifying a candidate hook/store/query from `annotask_get_data_sources` or from a task\'s `data_context`, to see how the project actually uses it (destructuring, parameters, common wrappers). ' +
      'Pass `kind` for more accurate matching: `store` looks for property reads too (`userStore.x`), hook/fetch/rpc look for call sites only.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Data source name to search for (case-sensitive identifier).' },
        kind: { type: 'string', enum: ['composable', 'signal', 'store', 'fetch', 'graphql', 'loader', 'rpc'], description: 'DataSource kind — tightens the match regex (store matches property access too; signal matches bare reads and calls).' },
        limit: { type: 'number', description: 'Max examples to return. Default 3, max 10.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'annotask_get_data_source_details',
    description:
      'Pull the *definition* of a project-specific data source (hook, store, fetch wrapper, GraphQL operation, tRPC router) by name. ' +
      'Complements `annotask_get_data_source_examples` (which shows call sites): this returns signature, return-type annotation, ±15 lines of surrounding body, the file\'s import block, co-located sibling exports, and referenced named types. ' +
      'Regex-driven in V1 — results carry `resolved_by: "regex"` and a `confidence` field (high | medium | low). When multiple definitions share the name, returns `{ error: "ambiguous", candidates }`; narrow with `file` and/or `kind` and call again. ' +
      'Not found → `{ error: "not_found", name }`.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Data source name (case-sensitive identifier).' },
        kind: { type: 'string', enum: ['composable', 'signal', 'store', 'fetch', 'graphql', 'loader', 'rpc'], description: 'Optional disambiguation when multiple kinds share a name.' },
        file: { type: 'string', description: 'Optional disambiguation — project-relative file path to resolve the definition against.' },
        context_lines: { type: 'number', description: 'Lines of body excerpt around the definition (default 15, max 40).' },
      },
      required: ['name'],
    },
  },
]

// ── Tool handlers ────────────────────────────────────

function toolError(text: string): { content: unknown[]; isError: true } {
  return { content: [{ type: 'text', text }], isError: true }
}

async function callTool(name: string, rawArgs: Record<string, unknown>, deps: McpDeps): Promise<{ content: unknown[]; isError?: boolean }> {
  switch (name) {
    case 'annotask_get_tasks': {
      const parsed = parseWith(McpGetTasksArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const args = parsed.data
      const taskData = deps.getTasks()
      let tasks = taskData.tasks
      if (args.status) tasks = tasks.filter(t => t.status === args.status)
      if (args.mfe) tasks = filterTasksByMfe(tasks, args.mfe)

      const output = args.detail === true
        ? tasks.map(stripVisual)
        : tasks.map(buildTaskSummary)

      return { content: [{ type: 'text', text: compact({ version: taskData.version, count: output.length, tasks: output }) }] }
    }

    case 'annotask_get_task': {
      const parsed = parseWith(McpGetTaskArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { task_id: taskId } = parsed.data
      const taskData = deps.getTasks()
      const task = taskData.tasks.find(t => t.id === taskId)
      if (!task) return toolError(`Task not found: ${taskId}`)
      const detail = trimAgentFeedback(stripVisual(task))
      return { content: [{ type: 'text', text: compact(detail) }] }
    }

    case 'annotask_update_task': {
      const parsed = parseWith(McpUpdateTaskArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const args = parsed.data
      const taskId = args.task_id

      const updates: Record<string, unknown> = {}

      // Handle questions → agent_feedback thread
      if (args.questions) {
        const taskData = deps.getTasks()
        const task = taskData.tasks.find(t => t.id === taskId)
        if (!task) return toolError(`Task not found: ${taskId}`)

        const entry: Record<string, unknown> = {
          asked_at: Date.now(),
          questions: args.questions,
        }
        if (args.question_context) entry.message = args.question_context
        const existingFeedback = Array.isArray(task.agent_feedback) ? task.agent_feedback : []
        const nextFeedback = [...existingFeedback, entry]
        const check = AgentFeedbackSchema.safeParse(nextFeedback)
        if (!check.success) return toolError(check.error.issues[0]?.message ?? 'Invalid agent_feedback')
        updates.agent_feedback = nextFeedback
        updates.status = args.status || 'needs_info'
      } else if (args.status) {
        updates.status = args.status
      }

      if (args.blocked_reason) {
        updates.blocked_reason = args.blocked_reason
        if (!updates.status) updates.status = 'blocked'
      }
      if (args.resolution) updates.resolution = args.resolution
      if (args.feedback) updates.feedback = args.feedback

      // Validate state transition
      if (updates.status) {
        const taskData = deps.getTasks()
        const task = taskData.tasks.find(t => t.id === taskId)
        if (!task) return toolError(`Task not found: ${taskId}`)
        const reason = assertTransition(task.status, updates.status)
        if (reason) return toolError(reason)
      }

      const result = await deps.updateTask(taskId, updates)
      return { content: [{ type: 'text', text: compact(stripVisual(result)) }] }
    }

    case 'annotask_create_task': {
      const parsed = parseWith(McpCreateTaskArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const args = parsed.data
      const task: Record<string, unknown> = { type: args.type, description: args.description }
      if (args.file) task.file = args.file
      if (args.line != null) task.line = args.line
      if (args.component) task.component = args.component
      if (args.mfe) task.mfe = args.mfe
      if (args.context) task.context = args.context
      const result = await deps.addTask(task)
      return { content: [{ type: 'text', text: compact(stripVisual(result)) }] }
    }

    case 'annotask_delete_task': {
      const parsed = parseWith(McpDeleteTaskArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const result = await deps.deleteTask(parsed.data.task_id)
      return { content: [{ type: 'text', text: compact(result) }] }
    }

    case 'annotask_get_design_spec': {
      const parsed = parseWith(McpGetDesignSpecArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const spec = deps.getDesignSpec() as Record<string, any> | null
      if (!spec) return { content: [{ type: 'text', text: compact({ initialized: false }) }] }

      const category = parsed.data.category
      if (category) {
        const slice: Record<string, unknown> = { version: spec.version, framework: spec.framework }
        if (category !== 'framework') {
          if (!(category in spec)) return toolError(`Unknown category: ${category}`)
          slice[category] = spec[category]
        }
        return { content: [{ type: 'text', text: compact(slice) }] }
      }

      // Summary mode: token counts instead of full data
      const summary = {
        version: spec.version,
        framework: spec.framework,
        counts: {
          colors: spec.colors?.length ?? 0,
          typographyFamilies: spec.typography?.families?.length ?? 0,
          typographyScale: spec.typography?.scale?.length ?? 0,
          spacing: spec.spacing?.length ?? 0,
          borderRadius: spec.borders?.radius?.length ?? 0,
        },
        hasBreakpoints: !!spec.breakpoints && Object.keys(spec.breakpoints).length > 0,
        icons: spec.icons ? { library: spec.icons.library } : null,
        components: spec.components ? { library: spec.components.library, used: spec.components.used?.length ?? 0 } : null,
      }
      return { content: [{ type: 'text', text: compact(summary) }] }
    }

    case 'annotask_get_components': {
      const parsed = parseWith(McpGetComponentsArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { search = '', library, category, used_only, detail = false, limit = 50, offset = 0 } = parsed.data
      const catalog = await scanComponentLibraries(deps.projectRoot) as { libraries?: ScannedLibraryLike[] }

      // Resolve the "used" set once, from design-spec, when used_only is requested.
      let usedSet: Set<string> | null = null
      if (used_only) {
        const spec = deps.getDesignSpec() as { components?: { used?: unknown } } | null
        const used = Array.isArray(spec?.components?.used) ? spec!.components!.used as unknown[] : []
        usedSet = new Set(used.filter((u): u is string => typeof u === 'string'))
      }

      const searchLc = search.toLowerCase()
      const libraries = (catalog.libraries || [])
        .filter(lib => !library || lib.name === library)
        .map((lib) => {
          let components = (lib.components || []).filter(c => {
            if (searchLc && !c.name.toLowerCase().includes(searchLc)) return false
            if (category && c.category !== category) return false
            if (usedSet && !usedSet.has(c.name)) return false
            return true
          })
          const total = components.length
          const paged = components.slice(offset, offset + limit)
          return {
            name: lib.name,
            version: lib.version,
            total,
            components: paged.map(c => detail ? c : componentSummary(c)),
          }
        }).filter(lib => lib.components.length > 0)

      return { content: [{ type: 'text', text: compact({ libraries }) }] }
    }

    case 'annotask_get_component': {
      const parsed = parseWith(McpGetComponentArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { name, library } = parsed.data
      const catalog = await scanComponentLibraries(deps.projectRoot) as { libraries?: ScannedLibraryLike[] }
      const matches: Array<{ library: string; version: string | undefined; component: ScannedComponentLike }> = []
      for (const lib of catalog.libraries || []) {
        if (library && lib.name !== library) continue
        for (const c of lib.components || []) {
          if (c.name === name) matches.push({ library: lib.name, version: lib.version, component: c })
        }
      }
      if (matches.length === 0) return toolError(`Component not found: ${name}${library ? ` (library: ${library})` : ''}`)
      if (matches.length > 1 && !library) {
        return {
          content: [{ type: 'text', text: compact({
            ambiguous: true,
            message: `Found ${matches.length} components named ${name}. Pass \`library\` to disambiguate.`,
            candidates: matches.map(m => ({ library: m.library, module: m.component.module })),
          }) }],
        }
      }
      const { library: libName, version, component } = matches[0]
      return { content: [{ type: 'text', text: compact({ library: libName, version, ...component }) }] }
    }

    case 'annotask_get_code_context': {
      const parsed = parseWith(McpGetCodeContextArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { task_id: taskId, context_lines: contextLines } = parsed.data
      const taskData = deps.getTasks()
      const task = taskData.tasks.find(t => t.id === taskId)
      if (!task) return toolError(`Task not found: ${taskId}`)
      const file = typeof task.file === 'string' ? task.file : ''
      const line = typeof task.line === 'number' ? task.line : 0
      if (!file) return toolError('Task has no file reference — cannot resolve code context')
      const workspaceRoot = await getWorkspaceRoot(deps.projectRoot)
      const result = await getCodeContext(deps.projectRoot, file, line, contextLines ?? 15, workspaceRoot)
      return { content: [{ type: 'text', text: compact(result) }] }
    }

    case 'annotask_get_component_examples': {
      const parsed = parseWith(McpGetComponentExamplesArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { name, limit } = parsed.data
      const result = await getComponentExamples(deps.projectRoot, name, limit ?? 3)
      return { content: [{ type: 'text', text: compact(result) }] }
    }

    case 'annotask_get_data_context': {
      const parsed = parseWith(McpGetDataContextArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { task_id: taskId, refresh } = parsed.data
      const taskData = deps.getTasks()
      const task = taskData.tasks.find(t => t.id === taskId)
      if (!task) return toolError(`Task not found: ${taskId}`)
      const stored = task.data_context
      if (!refresh && stored && typeof stored === 'object') {
        return { content: [{ type: 'text', text: compact(stored) }] }
      }
      const file = typeof task.file === 'string' ? task.file : ''
      const line = typeof task.line === 'number' ? task.line : 0
      if (!file) return toolError('Task has no file reference — cannot resolve data context')
      const workspaceRoot = await getWorkspaceRoot(deps.projectRoot)
      const result = await resolveDataContext(deps.projectRoot, file, line, {}, workspaceRoot)
      return { content: [{ type: 'text', text: compact(result) }] }
    }

    case 'annotask_get_interaction_history': {
      const parsed = parseWith(McpGetInteractionHistoryArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { task_id: taskId } = parsed.data
      const taskData = deps.getTasks()
      const task = taskData.tasks.find(t => t.id === taskId)
      if (!task) return toolError(`Task not found: ${taskId}`)
      // Prefer embedded — the user opted in, so it's guaranteed fresh relative
      // to the task. Fall back to the sidecar (always written at creation).
      if (task.interaction_history) {
        return { content: [{ type: 'text', text: compact(task.interaction_history) }] }
      }
      const stored = await deps.readInteractionHistory(taskId)
      if (stored == null) {
        return { content: [{ type: 'text', text: compact({ task_id: taskId, not_captured: true }) }] }
      }
      return { content: [{ type: 'text', text: compact(stored) }] }
    }

    case 'annotask_get_rendered_html': {
      const parsed = parseWith(McpGetRenderedHtmlArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { task_id: taskId } = parsed.data
      const taskData = deps.getTasks()
      const task = taskData.tasks.find(t => t.id === taskId)
      if (!task) return toolError(`Task not found: ${taskId}`)
      const ctx = task.context as Record<string, unknown> | undefined
      const embedded = ctx && typeof ctx.rendered === 'string' ? ctx.rendered : null
      if (embedded) {
        return { content: [{ type: 'text', text: compact({ task_id: taskId, rendered: embedded, source: 'embedded' }) }] }
      }
      const stored = await deps.readRenderedHtml(taskId)
      if (stored == null) {
        return { content: [{ type: 'text', text: compact({ task_id: taskId, rendered: null, not_captured: true }) }] }
      }
      return { content: [{ type: 'text', text: compact({ task_id: taskId, rendered: stored, source: 'sidecar' }) }] }
    }

    case 'annotask_get_data_sources': {
      const parsed = parseWith(McpGetDataSourcesArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const args = parsed.data
      const catalog = await scanDataSources(deps.projectRoot)
      const libraries = args.library ? catalog.libraries.filter(l => l.name === args.library) : catalog.libraries
      let entries = catalog.project_entries
      if (args.kind) entries = entries.filter(e => e.kind === args.kind)
      if (args.search) {
        const q = args.search.toLowerCase()
        entries = entries.filter(e => e.name.toLowerCase().includes(q))
      }
      if (args.used_only) entries = entries.filter(e => e.used_count > 0)
      return { content: [{ type: 'text', text: compact({ libraries, project_entries: entries, scannedAt: catalog.scannedAt }) }] }
    }

    case 'annotask_get_api_schemas': {
      const parsed = parseWith(McpGetApiSchemasArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { kind, detail } = parsed.data
      const catalog = await scanApiSchemas(deps.projectRoot)
      let schemas = catalog.schemas
      if (kind) schemas = schemas.filter(s => s.kind === kind)
      const emitted = detail ? schemas : schemas.map(s => ({ ...s, operations: [] }))
      return { content: [{ type: 'text', text: compact({ schemas: emitted, scannedAt: catalog.scannedAt }) }] }
    }

    case 'annotask_get_api_operation': {
      const parsed = parseWith(McpGetApiOperationArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { path, method, schema_location } = parsed.data
      const catalog = await scanApiSchemas(deps.projectRoot)
      const normMethod = method ? method.toUpperCase() : undefined
      const matches: Array<Record<string, unknown>> = []
      for (const schema of catalog.schemas) {
        if (schema_location && schema.location !== schema_location) continue
        for (const op of schema.operations) {
          if (op.path !== path) continue
          if (normMethod && op.method.toUpperCase() !== normMethod) continue
          matches.push({ schema_location: schema.location, schema_kind: schema.kind, operation: op })
        }
      }
      if (matches.length === 0) return toolError(`Operation not found: ${path}${method ? ` (${method})` : ''}`)
      if (matches.length === 1) return { content: [{ type: 'text', text: compact(matches[0]) }] }
      return { content: [{ type: 'text', text: compact({ ambiguous: true, candidates: matches }) }] }
    }

    case 'annotask_resolve_endpoint': {
      const parsed = parseWith(McpResolveEndpointArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { url, method } = parsed.data
      const catalog = await scanApiSchemas(deps.projectRoot)
      const match = resolveEndpoint(catalog, url, method)
      return { content: [{ type: 'text', text: compact({ match }) }] }
    }

    case 'annotask_get_data_source_examples': {
      const parsed = parseWith(McpGetDataSourceExamplesArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { name, kind, limit } = parsed.data
      const result = await getDataSourceExamples(deps.projectRoot, name, limit ?? 3, kind as DataSource['kind'] | undefined)
      return { content: [{ type: 'text', text: compact(result) }] }
    }

    case 'annotask_get_data_source_details': {
      const parsed = parseWith(McpGetDataSourceDetailsArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { name, kind, file, context_lines } = parsed.data
      const workspaceRoot = await getWorkspaceRoot(deps.projectRoot)
      const result = await resolveDataSourceDetails({
        projectRoot: deps.projectRoot,
        name,
        kind: kind as DataSource['kind'] | undefined,
        file,
        contextLines: context_lines,
        workspaceRoot,
      })
      return { content: [{ type: 'text', text: compact(result) }] }
    }

    case 'annotask_get_screenshot': {
      const parsed = parseWith(McpGetScreenshotArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const { task_id: taskId } = parsed.data
      const taskData = deps.getTasks()
      const task = taskData.tasks.find(t => t.id === taskId)
      if (!task) return toolError(`Task not found: ${taskId}`)
      if (!isSafeScreenshot(task.screenshot)) return toolError('Task has no screenshot')

      const screenshotPath = nodePath.join(deps.projectRoot, '.annotask', 'screenshots', task.screenshot)
      try {
        const data = await fsp.readFile(screenshotPath)
        return {
          content: [
            { type: 'image', data: data.toString('base64'), mimeType: 'image/png' },
            { type: 'text', text: `Screenshot for task ${taskId}: ${task.description}` },
          ],
        }
      } catch {
        return { content: [{ type: 'text', text: `Screenshot file not found: ${task.screenshot}` }], isError: true }
      }
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }
}

// ── JSON-RPC dispatcher ──────────────────────────────

async function handleJsonRpc(req: JsonRpcRequest, deps: McpDeps): Promise<JsonRpcResponse | null> {
  // Notifications have no id — return null (no response)
  if (req.id === undefined) return null

  switch (req.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
        id: req.id,
      }

    case 'ping':
      return { jsonrpc: '2.0', result: {}, id: req.id }

    case 'tools/list':
      return { jsonrpc: '2.0', result: { tools: TOOLS }, id: req.id }

    case 'tools/call': {
      const params = req.params as { name: string; arguments?: Record<string, unknown> } | undefined
      if (!params?.name) {
        return { jsonrpc: '2.0', error: { code: -32602, message: 'Missing tool name' }, id: req.id }
      }
      try {
        const result = await callTool(params.name, params.arguments ?? {}, deps)
        return { jsonrpc: '2.0', result, id: req.id }
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          result: { content: [{ type: 'text', text: `Tool error: ${err.message}` }], isError: true },
          id: req.id,
        }
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        error: { code: -32601, message: `Method not found: ${req.method}` },
        id: req.id,
      }
  }
}

// ── HTTP middleware (Streamable HTTP transport) ───────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_048_576) { req.destroy(); reject(new Error('Body too large')); return }
      body += chunk.toString()
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

export function createMcpMiddleware(deps: McpDeps) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/__annotask/mcp')) return next()

    // Localhost only
    if (!isLocalOrigin(req.headers.origin as string | undefined)) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    if (req.method === 'DELETE') {
      res.statusCode = 200
      res.end()
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('Allow', 'POST, DELETE')
      res.end()
      return
    }

    // Prevent caching of MCP responses
    res.setHeader('Cache-Control', 'no-store')

    let raw: string
    try { raw = await readBody(req) } catch {
      res.statusCode = 413
      res.end()
      return
    }

    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }))
      return
    }

    // Batch request — isolate per-item exceptions so one bad message doesn't truncate the response
    if (Array.isArray(parsed)) {
      const responses: JsonRpcResponse[] = []
      for (const item of parsed) {
        let result: JsonRpcResponse | null = null
        try {
          result = await handleJsonRpc(item as JsonRpcRequest, deps)
        } catch (err: any) {
          const id = (item && typeof item === 'object' && 'id' in item) ? (item as any).id ?? null : null
          result = { jsonrpc: '2.0', error: { code: -32603, message: `Internal error: ${err?.message ?? String(err)}` }, id }
        }
        if (result) responses.push(result)
      }
      if (responses.length === 0) {
        res.statusCode = 202
        res.end()
      } else {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(responses))
      }
      return
    }

    // Single request
    const request = parsed as JsonRpcRequest
    if (request.id === undefined) {
      // Notification — process but don't respond
      await handleJsonRpc(request, deps)
      res.statusCode = 202
      res.end()
      return
    }

    const response = await handleJsonRpc(request, deps)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
  }
}
