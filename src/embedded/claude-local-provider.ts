/**
 * Claude Code CLI (local) provider.
 *
 * Spawns `claude --print --output-format=stream-json --verbose` and pipes
 * the user prompt in on stdin. The CLI emits one JSON object per line on
 * stdout — we parse the subset we need (text deltas, usage, result) and
 * map to the shared `ProviderEvent` shape.
 *
 * Auth: the user must already be logged into the `claude` CLI
 * (`~/.claude/auth.json`). Annotask never sees the token.
 *
 * Reference shape: Claude Code's `stream-json` output (compatible with the
 * Anthropic SDK's event names: `message_start`, `content_block_delta`, …).
 */

import {
  CliLocalProvider,
  flattenMessagesAsPrompt,
  type ParsedLineResult,
  type SpawnRequest,
} from './cli-local-provider.js'
import type {
  ProviderEvent,
  ProviderMessage,
  ProviderTool,
  StreamOptions,
} from './provider.js'

export interface ClaudeLocalProviderOptions {
  /** Optional model id passed to `claude --model`. */
  model?: string
  /** Extra args appended after the canonical args. */
  extraArgs?: string[]
  spawnUrl?: string
  fetchImpl?: typeof fetch
}

export class ClaudeLocalProvider extends CliLocalProvider {
  private readonly model?: string
  private readonly extraArgs: string[]

  constructor(opts: ClaudeLocalProviderOptions = {}) {
    super({
      name: 'claude-local',
      spawnUrl: opts.spawnUrl,
      fetchImpl: opts.fetchImpl,
    })
    this.model = opts.model?.trim() || undefined
    this.extraArgs = (opts.extraArgs ?? []).filter((s) => s.trim().length > 0)
  }

  protected buildSpawn(
    messages: ProviderMessage[],
    _tools: ProviderTool[],
    options: StreamOptions,
  ): SpawnRequest {
    const args = ['--print', '--output-format', 'stream-json', '--verbose']
    // Skip the interactive permission prompt — task work from the embedded
    // agent is an explicit user action (clicking Run-with-agent or sending a
    // chat turn) and the shell has no UI to forward the prompt to. Without
    // this, edits silently fail with "Claude requested permissions to write
    // to <file>". The init flow (`server/init.ts`) does the same thing.
    args.push('--permission-mode', 'bypassPermissions')
    if (this.model) args.push('--model', this.model)
    args.push(...this.extraArgs)
    return {
      cli: 'claude',
      args,
      stdin: flattenMessagesAsPrompt(messages, options.systemPrompt),
    }
  }

  protected parseStdoutLine(line: string): ParsedLineResult {
    const trimmed = line.trim()
    if (!trimmed) return []
    let event: ClaudeStreamEvent
    try { event = JSON.parse(trimmed) as ClaudeStreamEvent }
    catch { return [] }
    return mapClaudeEvent(event)
  }
}

/**
 * Narrowed view of the `claude --output-format stream-json` event shapes
 * we read. The CLI emits a superset; we ignore anything we don't recognise.
 *
 * Two top-level envelopes carry content blocks:
 *   - `{type: 'assistant', message: {content: [...]}}` — model output. Blocks
 *     are `text` and `tool_use` (claude's tool loop only emits `tool_use`
 *     after the model finishes assembling JSON input, so we get them whole).
 *   - `{type: 'user', message: {content: [...]}}` — synthetic user message
 *     that wraps a tool's `tool_result` block. The CLI manufactures this
 *     turn after running the tool and before re-prompting the model.
 */
export interface ClaudeStreamEvent {
  type?: string
  message?: {
    role?: string
    content?: Array<ClaudeContentBlock>
    usage?: ClaudeUsage
  }
  usage?: ClaudeUsage
  [extra: string]: unknown
}

interface ClaudeContentBlock {
  type?: string
  // text block
  text?: string
  // tool_use block
  id?: string
  name?: string
  input?: unknown
  // tool_result block
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface ClaudeUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export function mapClaudeEvent(ev: ClaudeStreamEvent): ProviderEvent[] {
  if (ev.type === 'assistant' && ev.message) {
    const out: ProviderEvent[] = []
    for (const block of ev.message.content ?? []) {
      if (!block || typeof block.type !== 'string') continue
      if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
        out.push({ type: 'text', text: block.text })
      } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        out.push({ type: 'tool_call', id: block.id, name: block.name, input: block.input ?? {} })
      }
    }
    if (ev.message.usage) out.push(usageEvent(ev.message.usage))
    return out
  }
  if (ev.type === 'user' && ev.message) {
    // Tool results land as content blocks on a synthetic user turn.
    const out: ProviderEvent[] = []
    for (const block of ev.message.content ?? []) {
      if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      out.push({
        type: 'tool_result',
        toolUseId: block.tool_use_id,
        content: flattenToolResultContent(block.content),
        isError: block.is_error === true ? true : undefined,
      })
    }
    return out
  }
  if (ev.type === 'result' && ev.usage) {
    return [usageEvent(ev.usage)]
  }
  return []
}

/**
 * Tool-result content can be a plain string OR an array of `{type:'text',text}`
 * blocks (Claude SDK shape). Coerce to a single string for the work-stream.
 */
function flattenToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const c of content) {
      if (c && typeof c === 'object') {
        const obj = c as { type?: string; text?: string }
        if (obj.type === 'text' && typeof obj.text === 'string') parts.push(obj.text)
      }
    }
    if (parts.length > 0) return parts.join('\n')
  }
  // Unknown shapes (image blocks, structured payloads) round-trip as JSON so
  // the UI's expandable raw view still has something to show.
  try { return JSON.stringify(content) } catch { return '' }
}

function usageEvent(u: ClaudeUsage): ProviderEvent {
  return {
    type: 'usage',
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens,
    cacheCreationTokens: u.cache_creation_input_tokens,
  }
}
