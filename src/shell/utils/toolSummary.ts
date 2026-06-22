/**
 * Humanize agent tool calls + results for the Conversation work-stream.
 *
 * The agent CLIs (claude, codex, opencode) emit raw tool invocations as
 * `{name, input}` blobs. The UI surfaces a one-line summary per call
 * (`"Reading App.vue:42-89"`) and lets the user expand to see the raw JSON
 * input + full output. These templates produce the one-line summary.
 *
 * Unknown tools fall back to `name(key=value, …)` — never throw, never
 * lose information.
 */

/** Truncate a string with an ellipsis to keep one-liners scannable. */
function trunc(s: string, max = 60): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Render `file_path[:offset-end]` shorthand from a Read-style tool input. */
function pathWithRange(input: Record<string, unknown>): string {
  const file = typeof input.file_path === 'string' ? input.file_path : ''
  const off = typeof input.offset === 'number' ? input.offset : null
  const lim = typeof input.limit === 'number' ? input.limit : null
  if (off != null && lim != null) return `${file}:${off}-${off + lim - 1}`
  if (off != null) return `${file}:${off}+`
  return file
}

/**
 * Build the one-line summary for a tool call. Hand-tuned templates cover
 * the tools the claude/codex/opencode CLIs commonly run (Read/Write/Edit/
 * Bash/Grep/Glob/WebFetch/WebSearch/Task). Everything else falls through to
 * the generic `name(args)` rendering.
 */
export function summarizeToolCall(name: string, input: unknown): string {
  const args = (input && typeof input === 'object' && !Array.isArray(input))
    ? (input as Record<string, unknown>)
    : {}

  switch (name) {
    case 'Read': {
      const p = pathWithRange(args)
      return p ? `Reading ${p}` : 'Reading file'
    }
    case 'Write': {
      const p = typeof args.file_path === 'string' ? args.file_path : ''
      return p ? `Writing ${p}` : 'Writing file'
    }
    case 'Edit': {
      const p = typeof args.file_path === 'string' ? args.file_path : ''
      return p ? `Editing ${p}` : 'Editing file'
    }
    case 'MultiEdit': {
      const p = typeof args.file_path === 'string' ? args.file_path : ''
      const n = Array.isArray(args.edits) ? args.edits.length : 0
      return p ? `Editing ${p} (${n} edit${n === 1 ? '' : 's'})` : 'Editing file'
    }
    case 'NotebookEdit': {
      const p = typeof args.notebook_path === 'string' ? args.notebook_path : ''
      return p ? `Editing notebook ${p}` : 'Editing notebook'
    }
    case 'Bash': {
      const cmd = typeof args.command === 'string' ? args.command : ''
      return cmd ? `Running ${trunc(cmd, 80)}` : 'Running shell command'
    }
    case 'Grep': {
      const pat = typeof args.pattern === 'string' ? args.pattern : ''
      const path = typeof args.path === 'string' ? ` in ${args.path}` : ''
      return pat ? `Searching for "${trunc(pat, 40)}"${path}` : 'Searching'
    }
    case 'Glob': {
      const pat = typeof args.pattern === 'string' ? args.pattern : ''
      return pat ? `Listing ${pat}` : 'Listing files'
    }
    case 'WebFetch': {
      const url = typeof args.url === 'string' ? args.url : ''
      return url ? `Fetching ${trunc(url, 80)}` : 'Fetching URL'
    }
    case 'WebSearch': {
      const q = typeof args.query === 'string' ? args.query : ''
      return q ? `Searching the web for "${trunc(q, 60)}"` : 'Searching the web'
    }
    case 'Task': {
      const desc = typeof args.description === 'string' ? args.description : ''
      const agent = typeof args.subagent_type === 'string' ? args.subagent_type : ''
      if (desc && agent) return `Delegating to ${agent}: ${trunc(desc, 60)}`
      if (desc) return `Delegating: ${trunc(desc, 60)}`
      return 'Delegating sub-task'
    }
    case 'TodoWrite':
      return 'Updating todo list'
    case 'KillShell':
      return 'Killing shell'
    case 'BashOutput':
      return 'Reading shell output'
    default:
      return `${name}(${formatGenericArgs(args)})`
  }
}

/**
 * Build a short preview for a tool result. The full content is rendered in
 * the expandable details panel; this is what shows on the collapsed row.
 */
export function summarizeToolResult(content: string, isError?: boolean): string {
  const trimmed = content.trim()
  if (!trimmed) return isError ? 'Error' : 'OK'
  if (isError) return `Error: ${trunc(trimmed.split('\n')[0], 80)}`
  const lines = trimmed.split('\n').length
  if (lines > 3) return `${lines} lines returned`
  return trunc(trimmed.split('\n')[0], 80)
}

function formatGenericArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).slice(0, 3)
  if (entries.length === 0) return ''
  return entries.map(([k, v]) => `${k}=${formatValue(v)}`).join(', ')
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return `"${trunc(v, 30)}"`
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v == null) return String(v)
  if (Array.isArray(v)) return `[${v.length}]`
  return '{…}'
}
