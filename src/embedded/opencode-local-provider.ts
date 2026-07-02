/**
 * opencode CLI (local) provider.
 *
 * Spawns `opencode run --print-logs --format=json <prompt>` (opencode v0.x
 * uses positional prompt + JSON event stream). Each stdout line is one
 * JSON event; we surface assistant text and rely on the base class for
 * exit handling.
 *
 * opencode's JSON event surface is fluid across releases. We accept a
 * handful of likely shapes (`type: 'text'`, `type: 'message'` with content
 * blocks, plus a `text` top-level key as a fallback) so this keeps
 * working when opencode bumps. Unknown shapes drop silently — better to
 * lose a token than to crash the chat.
 */

import {
  CliLocalProvider,
  lastUserMessageText,
  rollupHistoryAsPrompt,
  type ParsedLineResult,
  type SpawnRequest,
} from './cli-local-provider.js'
import { opencodePermissionFlags, defaultPermissionModeFor } from './permission-mode-flags.js'
import type {
  ProviderEvent,
  ProviderMessage,
  ProviderTool,
  StreamOptions,
} from './provider.js'

export interface OpencodeLocalProviderOptions {
  /** Optional model id passed to `opencode run --model`. */
  model?: string
  extraArgs?: string[]
  spawnUrl?: string
  fetchImpl?: typeof fetch
}

export class OpencodeLocalProvider extends CliLocalProvider {
  private readonly model?: string
  private readonly extraArgs: string[]

  constructor(opts: OpencodeLocalProviderOptions = {}) {
    super({
      name: 'opencode-local',
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
    const args = ['run', '--print-logs', '--format=json']
    // Opencode only exposes a single `--dangerously-skip-permissions` toggle
    // in headless `run`; non-bypass modes omit it. Plan and default collapse
    // to the same behavior — the CLI doesn't surface finer granularity.
    // See permission-mode-flags.ts for the rationale.
    args.push(...opencodePermissionFlags(options.permissionMode ?? defaultPermissionModeFor('opencode')))
    if (this.model) args.push('--model', this.model)
    // Resume opencode's own persisted session: prior turns + instructions
    // already live server-side in the session store, so the positional is
    // ONLY the new user message. The base class retries cold when the
    // session turns out to be stale.
    if (options.resumeSessionId) args.push('--session', options.resumeSessionId)
    args.push(...this.extraArgs)
    // Prepend the annotask system prompt to the positional — opencode has
    // no separate system-prompt flag in headless mode — and roll up the
    // prior turns as a transcript, since each turn spawns a fresh
    // `opencode run` with no memory of its own. The `--` separator is
    // required: skill bodies often start with `---` (YAML frontmatter),
    // and without it the CLI parses the leading `--` as an unknown long flag.
    args.push('--', options.resumeSessionId
      ? lastUserMessageText(messages)
      : rollupHistoryAsPrompt(messages, options.systemPrompt))
    return { cli: 'opencode', args }
  }

  protected parseStdoutLine(line: string): ParsedLineResult {
    const trimmed = line.trim()
    if (!trimmed) return []
    let event: OpencodeEvent
    try { event = JSON.parse(trimmed) as OpencodeEvent }
    catch { return [] }
    return mapOpencodeEvent(event)
  }
}

interface OpencodeEvent {
  type?: string
  text?: string
  content?: string | Array<OpencodeContentBlock>
  // opencode v1.14+ wraps payloads inside a `part` envelope alongside the
  // top-level `type`. Text events look like:
  //   { type: 'text', part: { type: 'text', text: '...' } }
  // step_finish carries the run's usage totals:
  //   { type: 'step_finish', part: { type: 'step-finish',
  //       tokens: { input, output, cache: { read, write } }, reason, ... } }
  part?: OpencodePart
  // Session id spellings across versions — `opencode run --session <id>`
  // continues the session. v1.14+ stamps sessionID on part envelopes.
  sessionID?: string
  session_id?: string
  // Tool envelopes that some versions emit at the top level.
  id?: string
  name?: string
  input?: unknown
  call_id?: string
  output?: unknown
  is_error?: boolean
  usage?: { input_tokens?: number; output_tokens?: number }
  [extra: string]: unknown
}

interface OpencodePart {
  type?: string
  text?: string
  sessionID?: string
  tokens?: {
    input?: number
    output?: number
    cache?: { read?: number; write?: number }
  }
  [extra: string]: unknown
}

interface OpencodeContentBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

export function mapOpencodeEvent(ev: OpencodeEvent): ProviderEvent[] {
  const out: ProviderEvent[] = []
  // Session id for resume — spellings vary by version (top-level sessionID,
  // part.sessionID on v1.14+ envelopes, snake_case on older builds). Events
  // repeat it; the runner keeps the last one seen, so re-emitting is fine.
  const sid = firstNonEmpty(ev.sessionID, ev.part?.sessionID, ev.session_id)
  if (sid) out.push({ type: 'session', sessionId: sid })
  // Text-bearing shapes:
  //   1. v1.14+: { type: 'text', part: { type: 'text', text } }
  //   2. v1.14+: step_finish event carries usage totals on part.tokens
  //   3. legacy: { type: 'text',    text }
  //   4. legacy: { type: 'assistant', text }
  //   5. legacy: { type: 'message', content: 'string' | block[] }
  if (ev.type === 'text' && ev.part && typeof ev.part.text === 'string') {
    out.push({ type: 'text', text: ev.part.text })
  } else if (ev.type === 'text' && typeof ev.text === 'string') {
    out.push({ type: 'text', text: ev.text })
  } else if (ev.type === 'assistant' && typeof ev.text === 'string') {
    out.push({ type: 'text', text: ev.text })
  } else if (typeof ev.content === 'string' && ev.content.length > 0) {
    out.push({ type: 'text', text: ev.content })
  } else if (Array.isArray(ev.content)) {
    for (const block of ev.content) {
      if (!block || typeof block.type !== 'string') continue
      if (block.type === 'text' && typeof block.text === 'string') {
        out.push({ type: 'text', text: block.text })
      } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        out.push({ type: 'tool_call', id: block.id, name: block.name, input: block.input ?? {} })
      } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        out.push({
          type: 'tool_result',
          toolUseId: block.tool_use_id,
          content: coerceToString(block.content),
          isError: block.is_error === true ? true : undefined,
        })
      }
    }
  }
  // Tool envelopes at the top level (newer opencode shapes).
  if (ev.type === 'tool_call' && typeof ev.id === 'string' && typeof ev.name === 'string') {
    out.push({ type: 'tool_call', id: ev.id, name: ev.name, input: ev.input ?? {} })
  }
  if (ev.type === 'tool_result' && typeof ev.call_id === 'string') {
    out.push({
      type: 'tool_result',
      toolUseId: ev.call_id,
      content: coerceToString(ev.output),
      isError: ev.is_error === true ? true : undefined,
    })
  }
  if (ev.usage && (ev.usage.input_tokens || ev.usage.output_tokens)) {
    out.push({
      type: 'usage',
      inputTokens: ev.usage.input_tokens ?? 0,
      outputTokens: ev.usage.output_tokens ?? 0,
    })
  }
  // v1.14+: step_finish carries the turn's token totals on part.tokens.
  if (ev.type === 'step_finish' && ev.part?.tokens) {
    const t = ev.part.tokens
    if (typeof t.input === 'number' || typeof t.output === 'number') {
      out.push({
        type: 'usage',
        inputTokens: t.input ?? 0,
        outputTokens: t.output ?? 0,
        cacheReadTokens: t.cache?.read,
        cacheCreationTokens: t.cache?.write,
      })
    }
  }
  return out
}

function coerceToString(v: unknown): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  try { return JSON.stringify(v) } catch { return String(v) }
}

function firstNonEmpty(...vals: Array<string | undefined>): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}
