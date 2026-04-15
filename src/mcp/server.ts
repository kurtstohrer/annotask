import type { IncomingMessage, ServerResponse } from 'node:http'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'
import { isLocalOrigin } from '../server/origin.js'
import { scanComponentLibraries } from '../server/component-scanner.js'
import { buildTaskSummary, filterTasksByMfe } from '../shared/task-summary.js'

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
  addTask: (task: Record<string, unknown>) => unknown
  updateTask: (id: string, updates: Record<string, unknown>) => unknown
  deleteTask: (id: string) => unknown
}

// ── Constants ────────────────────────────────────────

/** Compact JSON for MCP responses: no indentation, strips null/undefined/empty-array fields */
function compact(data: unknown): string {
  return JSON.stringify(data, (_key, value) => {
    if (value === null || value === undefined) return undefined
    if (Array.isArray(value) && value.length === 0) return undefined
    return value
  })
}

/** Strip fields that are only useful for the shell UI, not agents */
function stripVisual(task: unknown): Record<string, unknown> {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return {}
  const { visual, ...rest } = task as Record<string, unknown>
  return rest
}

const PROTOCOL_VERSION = '2025-03-26'
const SERVER_INFO = { name: 'annotask', version: '0.0.28' }

const VALID_TRANSITIONS: Record<string, Set<string>> = {
  pending:     new Set(['in_progress', 'denied']),
  in_progress: new Set(['applied', 'review', 'needs_info', 'blocked', 'denied']),
  applied:     new Set(['review', 'in_progress']),
  review:      new Set(['accepted', 'denied', 'in_progress']),
  needs_info:  new Set(['in_progress', 'denied']),
  blocked:     new Set(['in_progress', 'denied']),
  denied:      new Set(['pending', 'in_progress']),
}

// ── Tool definitions ─────────────────────────────────

const TOOLS: ToolDef[] = [
  {
    name: 'annotask_get_tasks',
    description:
      'Get design tasks from Annotask. Returns task summaries by default (id, type, status, description, file, line, action, screenshot). ' +
      'Use detail=true for full objects including context, viewport, element_context, and interaction_history. ' +
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
      'Get full details for a single task by ID. Returns all fields including context, element_context, interaction_history, and agent_feedback. ' +
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
    description: 'Create a new design task with "pending" status. Types: annotation, style_update, section_request, a11y_fix, theme_update.',
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
      'Search component library components detected in node_modules. Returns component names, import paths, and prop definitions. ' +
      'Without a search query, returns up to 20 components per library with a total count.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Filter components by name (case-insensitive substring match)' },
      },
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
]

// ── Tool handlers ────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>, deps: McpDeps): Promise<{ content: unknown[]; isError?: boolean }> {
  switch (name) {
    case 'annotask_get_tasks': {
      const taskData = deps.getTasks()
      let tasks = taskData.tasks
      if (typeof args.status === 'string') tasks = tasks.filter(t => t.status === args.status)
      if (typeof args.mfe === 'string') tasks = filterTasksByMfe(tasks, args.mfe)

      const output = args.detail === true
        ? tasks.map(stripVisual)
        : tasks.map(buildTaskSummary)

      return { content: [{ type: 'text', text: compact({ version: taskData.version, count: output.length, tasks: output }) }] }
    }

    case 'annotask_get_task': {
      const taskId = typeof args.task_id === 'string' ? args.task_id : ''
      if (!taskId) return { content: [{ type: 'text', text: 'Missing required parameter: task_id' }], isError: true }
      const taskData = deps.getTasks()
      const task = taskData.tasks.find(t => t.id === taskId)
      if (!task) return { content: [{ type: 'text', text: `Task not found: ${taskId}` }], isError: true }
      const detail = stripVisual(task)
      // Trim agent_feedback: keep latest resolved exchange + all unresolved
      if (Array.isArray(detail.agent_feedback)) {
        const feedback = detail.agent_feedback as Array<{ answers?: unknown[] }>
        const resolved = feedback.filter(e => Array.isArray(e.answers) && e.answers.length > 0)
        const unresolved = feedback.filter(e => !Array.isArray(e.answers) || e.answers.length === 0)
        const trimmed = [...(resolved.length > 0 ? [resolved[resolved.length - 1]] : []), ...unresolved]
        detail.agent_feedback = trimmed.length > 0 ? trimmed : undefined
      }
      return { content: [{ type: 'text', text: compact(detail) }] }
    }

    case 'annotask_update_task': {
      const taskId = typeof args.task_id === 'string' ? args.task_id : ''
      if (!taskId) return { content: [{ type: 'text', text: 'Missing required parameter: task_id' }], isError: true }

      const updates: Record<string, unknown> = {}

      // Handle questions → agent_feedback thread
      if (args.questions) {
        const taskData = deps.getTasks()
        const task = taskData.tasks.find(t => t.id === taskId)
        if (!task) return { content: [{ type: 'text', text: `Task not found: ${taskId}` }], isError: true }

        const entry: Record<string, unknown> = {
          asked_at: Date.now(),
          questions: args.questions,
        }
        if (args.question_context) entry.message = args.question_context
        const existingFeedback = Array.isArray(task.agent_feedback) ? task.agent_feedback : []
        updates.agent_feedback = [...existingFeedback, entry]
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
        if (!task) return { content: [{ type: 'text', text: `Task not found: ${taskId}` }], isError: true }
        const allowed = VALID_TRANSITIONS[String(task.status)]
        if (allowed && !allowed.has(updates.status as string)) {
          return {
            content: [{ type: 'text', text: `Invalid state transition: ${String(task.status)} → ${updates.status}. Allowed: ${[...allowed].join(', ')}` }],
            isError: true,
          }
        }
      }

      const result = deps.updateTask(taskId, updates)
      return { content: [{ type: 'text', text: compact(stripVisual(result)) }] }
    }

    case 'annotask_create_task': {
      if (!args.type || !args.description) {
        return { content: [{ type: 'text', text: 'Missing required parameters: type, description' }], isError: true }
      }
      const task: Record<string, unknown> = { type: args.type, description: args.description }
      if (args.file) task.file = args.file
      if (args.line != null) task.line = args.line
      if (args.component) task.component = args.component
      if (args.mfe) task.mfe = args.mfe
      if (args.context) task.context = args.context
      const result = deps.addTask(task)
      return { content: [{ type: 'text', text: compact(stripVisual(result)) }] }
    }

    case 'annotask_delete_task': {
      const taskId = args.task_id as string
      if (!taskId) return { content: [{ type: 'text', text: 'Missing required parameter: task_id' }], isError: true }
      const result = deps.deleteTask(taskId)
      return { content: [{ type: 'text', text: compact(result) }] }
    }

    case 'annotask_get_design_spec': {
      const spec = deps.getDesignSpec() as Record<string, any> | null
      if (!spec) return { content: [{ type: 'text', text: compact({ initialized: false }) }] }

      const category = typeof args.category === 'string' ? args.category : undefined
      if (category) {
        const slice: Record<string, unknown> = { version: spec.version, framework: spec.framework }
        if (category !== 'framework') {
          if (!(category in spec)) {
            return { content: [{ type: 'text', text: `Unknown category: ${category}` }], isError: true }
          }
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
      const catalog = await scanComponentLibraries(deps.projectRoot) as { libraries?: Array<{ name: string; version?: string; components?: Array<{ name: string }> }> }
      const search = (typeof args.search === 'string' ? args.search : '').toLowerCase()
      const MAX_RESULTS = 20

      const result = {
        libraries: (catalog.libraries || []).map((lib) => {
          let components = lib.components || []
          if (search) {
            components = components.filter(c => c.name.toLowerCase().includes(search))
          }
          const total = components.length
          return {
            name: lib.name,
            version: lib.version,
            total,
            components: components.slice(0, MAX_RESULTS),
          }
        }).filter(lib => lib.components.length > 0),
      }
      return { content: [{ type: 'text', text: compact(result) }] }
    }

    case 'annotask_get_screenshot': {
      const taskId = typeof args.task_id === 'string' ? args.task_id : ''
      if (!taskId) return { content: [{ type: 'text', text: 'Missing required parameter: task_id' }], isError: true }
      const taskData = deps.getTasks()
      const task = taskData.tasks.find(t => t.id === taskId)
      if (!task) return { content: [{ type: 'text', text: `Task not found: ${taskId}` }], isError: true }
      if (typeof task.screenshot !== 'string' || !task.screenshot) {
        return { content: [{ type: 'text', text: 'Task has no screenshot' }], isError: true }
      }

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

    // Batch request
    if (Array.isArray(parsed)) {
      const responses: JsonRpcResponse[] = []
      for (const item of parsed) {
        const result = await handleJsonRpc(item as JsonRpcRequest, deps)
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
