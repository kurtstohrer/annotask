// MCP tool catalog + in-process dispatcher.
//
// Both the MCP HTTP server (src/mcp/server.ts) and the embedded agent
// (src/embedded/tool-bridge.ts) dispatch through `callTool` so external
// editors and the in-shell runner see identical tool semantics.

import fsp from 'node:fs/promises'
import nodePath from 'node:path'
import { scanComponentLibraries } from '../server/component-scanner.js'
import { buildTaskSummary, filterTasksByMfe, stripTaskVisual, trimAgentFeedback, compactJson } from '../shared/task-summary.js'
import { isSafeScreenshot } from '../server/validation.js'
import { getCodeContext } from '../server/code-context.js'
import { getComponentExamples } from '../server/component-examples.js'
import { resolveDataContext } from '../server/data-context.js'
import { scanDataSources } from '../server/data-source-scanner.js'
import { mergeRuntimeOrphansIntoEntries, findMatchingStaticEntries } from '../server/runtime-endpoints.js'
import { getDataSourceExamples } from '../server/data-source-examples.js'
import { resolveDataSourceDetails } from '../server/data-source-details.js'
import { scanApiSchemas } from '../server/api-schema-scanner.js'
import { resolveEndpoint } from '../server/api-schema-resolver.js'
import { resolveWorkspace } from '../server/workspace.js'
import { TASK_TYPES, type DataSource, type RuntimeEndpoint, type RuntimeEndpointCatalog } from '../schema.js'
import type { TaskThreadStore, ThreadMessage } from '../server/task-thread.js'
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
  McpGetRuntimeEndpointsArgs,
  parseWith,
  assertTransition,
  AgentFeedbackSchema,
} from '../server/schemas.js'

export interface ToolDef {
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
  /** Aggregated runtime-observed endpoint catalog. Optional — when missing, the MCP tool returns an empty catalog. */
  getRuntimeEndpointCatalog?: () => RuntimeEndpointCatalog
  /** Per-task conversation thread store. When omitted, the conversation tools return errors. */
  taskThread?: TaskThreadStore
}

export interface ToolResult {
  content: unknown[]
  isError?: boolean
}

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

export const MCP_TOOLS: ToolDef[] = [
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
      'Use this when you are about to reuse or place a component and want to match the repo\'s own conventions (prop combinations, wrapper patterns, slot usage) rather than invent new ones. ' +
      'Pass `library` (e.g. `@mantine/core`, `radix-vue`) to keep same-name components from different libraries out of the result.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Component name to search for (case-sensitive)' },
        limit: { type: 'number', description: 'Max examples to return. Default 3, max 10.' },
        library: { type: 'string', description: 'Optional library/package name (e.g. @mantine/core). Only examples whose import specifier belongs to this library are returned.' },
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
      '`project_entries` come sorted by `used_count` descending — the most load-bearing entries first. Use this when deciding which existing data source to reuse before writing new code. ' +
      'By default, orphan endpoints observed at runtime (fetch/XHR traffic the regex scanner missed) are promoted into `project_entries` with `discovered_by: "runtime"` and `file: ""` — these represent real APIs the frontend hits but that the static pass couldn\'t pin to a source location. Pass `merge_runtime: false` for a pure static-scan view; use `annotask_get_runtime_endpoints` for the full runtime catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['composable', 'signal', 'store', 'fetch', 'graphql', 'loader', 'rpc'], description: 'Only return project entries of this kind. "composable" covers React hooks, Vue composables, Svelte helpers, Solid primitive wrappers. "signal" is fine-grained reactive (Solid createSignal, Svelte store reads).' },
        library: { type: 'string', description: 'Only return this library from the libraries list.' },
        search: { type: 'string', description: 'Substring match on project entry name (case-insensitive).' },
        used_only: { type: 'boolean', description: 'Restrict project entries to `used_count > 0` — analogous to `annotask_get_components` used_only filter.' },
        merge_runtime: { type: 'boolean', description: 'Include orphan runtime-observed endpoints as synthetic `project_entries` (default true). These carry `discovered_by: "runtime"` and have `file: ""` because they were found by live network capture, not source scan. Set false for static-only.' },
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
    name: 'annotask_get_runtime_endpoints',
    description:
      'List endpoints the frontend has *actually hit at runtime* — captured by the iframe-side network monitor (fetch + XHR + sendBeacon) and aggregated per (origin, method, path pattern). ' +
      'This is the runtime counterpart to `annotask_get_data_sources`, whose regex-driven static scan can miss endpoints built from computed strings, generated clients, or dynamic libraries. ' +
      'Each row carries `count`, `routes[]` (per iframe route with per-route counts), `statuses[]`, and a rotating `sampleUrls[]` for debugging. ' +
      'When `enrich` is true (default), rows also include `matchedSources` (static `ProjectDataEntry` names whose endpoint aligns with this call) and `matchedSchemaLocation` / `matchedOperationId` for the best OpenAPI / GraphQL / tRPC operation match. ' +
      'Use `orphans_only: true` to surface endpoints the static scanner missed — those are the highest-value gaps to look at.',
    inputSchema: {
      type: 'object',
      properties: {
        route: { type: 'string', description: 'Filter to endpoints hit on this iframe route (e.g. "/dashboard"). Matches against the per-call route recorded at capture time.' },
        method: { type: 'string', description: 'Filter by HTTP method (GET/POST/PUT/PATCH/DELETE). Case-insensitive.' },
        search: { type: 'string', description: 'Substring match (case-insensitive) on the endpoint path or one of its sample URLs.' },
        orphans_only: { type: 'boolean', description: 'Only return endpoints with no matching static data source — gaps the regex scanner missed.' },
        enrich: { type: 'boolean', description: 'Cross-reference each endpoint against the static data-source catalog and discovered API schemas. Default true.' },
      },
    },
  },
  {
    name: 'annotask_conversation_read',
    description:
      'Read the per-task conversation thread for the embedded chat. Returns messages in append order. ' +
      'Use `after_id` to fetch only messages newer than a known id (cheap polling).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task whose conversation to read.' },
        after_id: { type: 'string', description: 'Return only messages with an id greater than this.' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'annotask_conversation_post',
    description:
      'Append a message to a task\'s conversation thread. Used by external CLI agents (claude/codex/opencode) so the in-shell Conversation tab and the terminal stay in sync. ' +
      '`role` is one of user|assistant|system|tool. The returned record carries the server-minted `id` and `ts`.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task whose conversation to post to.' },
        role: { type: 'string', enum: ['user', 'assistant', 'system', 'tool'] },
        content: { type: 'string', description: 'Message content (markdown allowed).' },
        provider_id: { type: 'string', description: 'Provider that generated the turn (for assistant messages).' },
        model: { type: 'string', description: 'Model id reported by the provider.' },
      },
      required: ['task_id', 'role', 'content'],
    },
  },
  {
    name: 'annotask_conversation_subscribe',
    description:
      'Long-poll for new conversation messages. Returns immediately if there are messages after `after_id`; otherwise waits up to `timeout_ms` (default 25000, max 55000) for one. ' +
      'External agents loop on this tool to mirror an SSE subscription without persistent connections.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        after_id: { type: 'string', description: 'Latest id the caller has already seen.' },
        timeout_ms: { type: 'number', description: 'Max wait in milliseconds (default 25000, max 55000).' },
      },
      required: ['task_id'],
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

function toolError(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * In-process tool dispatcher. Both the MCP HTTP transport and the embedded
 * agent route through here. Returns a `{ content, isError? }` envelope shaped
 * for MCP `tools/call` responses.
 */
export async function callTool(name: string, rawArgs: Record<string, unknown>, deps: McpDeps): Promise<ToolResult> {
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
      const { name, limit, library } = parsed.data
      const result = await getComponentExamples(deps.projectRoot, name, limit ?? 3, library)
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
      const mergeRuntime = args.merge_runtime !== false
      if (mergeRuntime && deps.getRuntimeEndpointCatalog) {
        const runtimeCat = deps.getRuntimeEndpointCatalog()
        entries = mergeRuntimeOrphansIntoEntries(entries, runtimeCat.endpoints)
      }
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

    case 'annotask_get_runtime_endpoints': {
      const parsed = parseWith(McpGetRuntimeEndpointsArgs, rawArgs)
      if (!parsed.ok) return toolError(parsed.error)
      const args = parsed.data
      const enrich = args.enrich !== false
      const catalog = deps.getRuntimeEndpointCatalog
        ? deps.getRuntimeEndpointCatalog()
        : { version: '1.0' as const, updatedAt: 0, endpoints: [] as RuntimeEndpoint[] }
      let endpoints = catalog.endpoints
      if (args.route) endpoints = endpoints.filter(ep => ep.routes.some(r => r.route === args.route))
      if (args.method) {
        const m = args.method.toUpperCase()
        endpoints = endpoints.filter(ep => ep.method === m)
      }
      if (args.search) {
        const q = args.search.toLowerCase()
        endpoints = endpoints.filter(ep =>
          ep.path.toLowerCase().includes(q)
          || ep.pattern.toLowerCase().includes(q)
          || ep.sampleUrls.some(u => u.toLowerCase().includes(q)),
        )
      }
      if (enrich) {
        const [staticCat, schemaCat] = await Promise.all([
          scanDataSources(deps.projectRoot),
          scanApiSchemas(deps.projectRoot),
        ])
        endpoints = endpoints.map(ep => enrichRuntimeEndpoint(ep, staticCat.project_entries, schemaCat))
      }
      if (args.orphans_only) {
        endpoints = endpoints.filter(ep => !ep.matchedSources || ep.matchedSources.length === 0)
      }
      return { content: [{ type: 'text', text: compact({ version: catalog.version, updatedAt: catalog.updatedAt, endpoints }) }] }
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

    case 'annotask_conversation_read': {
      const taskId = stringArg(rawArgs, 'task_id')
      if (!taskId) return toolError('`task_id` is required')
      const afterId = optionalStringArg(rawArgs, 'after_id')
      if (!deps.taskThread) return toolError('Conversation store is not available')
      const msgs = await deps.taskThread.read(taskId, { afterId: afterId })
      return { content: [{ type: 'text', text: compact({ task_id: taskId, count: msgs.length, messages: msgs }) }] }
    }

    case 'annotask_conversation_post': {
      const taskId = stringArg(rawArgs, 'task_id')
      const role = stringArg(rawArgs, 'role')
      const content = stringArg(rawArgs, 'content')
      if (!taskId || !role || !content) return toolError('`task_id`, `role`, and `content` are required')
      if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') {
        return toolError('`role` must be user|assistant|system|tool')
      }
      if (!deps.taskThread) return toolError('Conversation store is not available')
      const msg = await deps.taskThread.append(taskId, {
        role,
        content,
        providerId: optionalStringArg(rawArgs, 'provider_id'),
        model: optionalStringArg(rawArgs, 'model'),
      })
      return { content: [{ type: 'text', text: compact(msg) }] }
    }

    case 'annotask_conversation_subscribe': {
      const taskId = stringArg(rawArgs, 'task_id')
      if (!taskId) return toolError('`task_id` is required')
      if (!deps.taskThread) return toolError('Conversation store is not available')
      const afterId = optionalStringArg(rawArgs, 'after_id')
      const requestedTimeout = typeof rawArgs.timeout_ms === 'number' ? rawArgs.timeout_ms : 25_000
      const timeoutMs = Math.max(0, Math.min(55_000, requestedTimeout))
      const initial = await deps.taskThread.read(taskId, { afterId })
      if (initial.length > 0) {
        return { content: [{ type: 'text', text: compact({ task_id: taskId, count: initial.length, messages: initial }) }] }
      }
      const store = deps.taskThread
      const received = await new Promise<ThreadMessage | null>((resolve) => {
        const unsubscribe = store.subscribe(taskId, (m) => {
          unsubscribe()
          clearTimeout(t)
          resolve(m)
        })
        const t = setTimeout(() => { unsubscribe(); resolve(null) }, timeoutMs)
      })
      const msgs = received ? [received] : []
      return { content: [{ type: 'text', text: compact({ task_id: taskId, count: msgs.length, messages: msgs }) }] }
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

/**
 * Annotate a runtime endpoint with the matching static sources and OpenAPI
 * operation. Mirrors the HTTP-side helper in `server/api.ts` — kept local so
 * the MCP layer doesn't have to import back into api.ts.
 */
function enrichRuntimeEndpoint(
  ep: RuntimeEndpoint,
  staticEntries: Array<{ name: string; method?: string; endpoint?: string; resolved_endpoint?: string }>,
  schemaCatalog: Awaited<ReturnType<typeof scanApiSchemas>>,
): RuntimeEndpoint {
  const out: RuntimeEndpoint = { ...ep }
  const matched: string[] = []
  for (const entry of findMatchingStaticEntries(ep, staticEntries)) {
    if (!matched.includes(entry.name)) matched.push(entry.name)
  }
  if (matched.length > 0) out.matchedSources = matched
  const sampleUrl = ep.sampleUrls[0] || ep.path
  const match = resolveEndpoint(schemaCatalog, sampleUrl, ep.method)
  if (match) {
    out.matchedSchemaLocation = match.schema_location
    if (match.operation.id) out.matchedOperationId = match.operation.id
  }
  return out
}
