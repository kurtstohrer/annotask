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
  lastUserMessageText,
  POSITIONAL_PROMPT_MAX_CHARS,
  type ParsedLineResult,
  type SpawnRequest,
} from './cli-local-provider.js'
import { claudePermissionFlags, defaultPermissionModeFor } from './permission-mode-flags.js'
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
    // Permission mode is resolved + headless-normalized per-call (task ??
    // persona ?? global, then normalizeHeadlessMode). The fail-safe fallback is
    // claude's safe default (bypass — claude has no headless ask-mode), not a
    // blanket bypass for every CLI. Permission/model flags ride resume spawns
    // too — enforcement must hold even when the conversation context doesn't
    // get re-sent.
    args.push(...claudePermissionFlags(options.permissionMode ?? defaultPermissionModeFor('claude')))
    if (this.model) args.push('--model', this.model)
    args.push(...this.extraArgs)
    if (options.resumeSessionId) {
      // Resume the CLI's own persisted session: the system prompt and every
      // prior turn already live in it, so stdin carries ONLY the new user
      // message. The base class falls back to the cold path below when the
      // session turns out to be stale.
      args.push('--resume', options.resumeSessionId)
      return { cli: 'claude', args, stdin: lastUserMessageText(messages) }
    }
    // When the installed CLI supports it, ship the composed skill prompt as a
    // REAL system-prompt append instead of prepending it to the user message:
    // it lands adjacent to Claude Code's own cached prefix (covered by its
    // cache_control breakpoints), so back-to-back spawns re-read the stable
    // 22-39KB skill block at cache-read pricing — and instructions stop being
    // framed as user speech. Guarded by the same argv budget as the
    // positional CLIs (a single Linux argv string caps at 128KiB).
    const sys = options.systemPrompt ?? ''
    if (options.cliCapabilities?.appendSystemPrompt === true && sys.length > 0 && sys.length <= POSITIONAL_PROMPT_MAX_CHARS) {
      args.push('--append-system-prompt', sys)
      return { cli: 'claude', args, stdin: flattenMessagesAsPrompt(messages, '') }
    }
    return {
      cli: 'claude',
      args,
      stdin: flattenMessagesAsPrompt(messages, sys),
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
  /** `system` envelope discriminator — `'init'` on the session-opening event. */
  subtype?: string
  /** Claude Code stamps the session id on every stream-json envelope; we only
   *  read it off `system`(init) and `result` to avoid event spam. */
  session_id?: string
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
  // Session id for resume: the `system`/init envelope opens the session; the
  // `result` envelope closes it and re-states the id (a resumed run mints a
  // NEW id there — that's the one the next turn must resume from).
  if ((ev.type === 'system' && ev.subtype === 'init') || ev.type === 'result') {
    const out: ProviderEvent[] = []
    if (typeof ev.session_id === 'string' && ev.session_id.length > 0) {
      out.push({ type: 'session', sessionId: ev.session_id })
    }
    if (ev.type === 'result' && ev.usage) out.push(usageEvent(ev.usage))
    return out
  }
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
