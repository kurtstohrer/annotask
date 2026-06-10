/**
 * OpenAI Codex CLI (local) provider.
 *
 * Spawns `codex exec --json` and pipes the user prompt in on stdin. The
 * CLI emits one JSON line per event on stdout. We read the events we need
 * to drive the chat UI: `item.completed` for assistant text, `turn.completed`
 * for usage and termination.
 *
 * Auth: the user must already be logged into the `codex` CLI. Annotask
 * never sees their token.
 */

import {
  CliLocalProvider,
  rollupHistoryAsPrompt,
  type ParsedLineResult,
  type SpawnRequest,
} from './cli-local-provider.js'
import { codexPermissionFlags, defaultPermissionModeFor } from './permission-mode-flags.js'
import type {
  ProviderEvent,
  ProviderMessage,
  ProviderTool,
  StreamOptions,
} from './provider.js'

export interface CodexLocalProviderOptions {
  /** Optional model id passed to `codex exec --model`. */
  model?: string
  extraArgs?: string[]
  spawnUrl?: string
  fetchImpl?: typeof fetch
}

export class CodexLocalProvider extends CliLocalProvider {
  private readonly model?: string
  private readonly extraArgs: string[]

  constructor(opts: CodexLocalProviderOptions = {}) {
    super({
      name: 'codex-local',
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
    const args = ['exec', '--json']
    // Permission mode → codex sandbox flags. `bypass` keeps the historical
    // `--dangerously-bypass-approvals-and-sandbox`; `plan` clamps the sandbox
    // to `read-only`; `default` uses `--full-auto` (workspace-write sandbox).
    // Headless `exec` doesn't surface per-action approvals. The fail-safe
    // fallback is codex's safe default (`default` = sandboxed), not bypass.
    args.push(...codexPermissionFlags(options.permissionMode ?? defaultPermissionModeFor('codex')))
    // Allow running in projects that aren't a git repo. Without this, codex
    // refuses to start when the dev server's cwd isn't inside a repository.
    args.push('--skip-git-repo-check')
    if (this.model) args.push('--model', this.model)
    // Map effort → `-c model_reasoning_effort=<level>` (Codex's only knob).
    // `auto` and `minimal` map to nothing — Codex picks its own default.
    if (options.effort && options.effort !== 'auto' && options.effort !== 'minimal') {
      args.push('-c', `model_reasoning_effort=${options.effort}`)
    }
    args.push(...this.extraArgs)
    // Codex consumes the prompt as the trailing positional arg. Prepend the
    // annotask system prompt so the persona's instructions reach the model
    // even though codex has no separate system-prompt flag, and roll up the
    // prior turns as a transcript — each turn spawns a fresh `codex exec`,
    // so the prompt is the only memory follow-up messages get. The `--`
    // separator is required: skill bodies often start with `---` (YAML
    // frontmatter), and without it clap parses the leading `--` as an
    // unknown long flag.
    args.push('--', rollupHistoryAsPrompt(messages, options.systemPrompt))
    return { cli: 'codex', args }
  }

  protected parseStdoutLine(line: string): ParsedLineResult {
    const trimmed = line.trim()
    if (!trimmed) return []
    let event: CodexEvent
    try { event = JSON.parse(trimmed) as CodexEvent }
    catch { return [] }
    return mapCodexEvent(event)
  }
}

export interface CodexEvent {
  type?: string
  item?: CodexItem
  usage?: {
    input_tokens?: number
    cached_input_tokens?: number
    output_tokens?: number
  }
  [extra: string]: unknown
}

/**
 * Codex item shapes vary by version. We accept the common surface — `id`,
 * `item_type`, plus optional fields per kind. Each branch in mapCodexEvent
 * narrows to what it needs.
 */
interface CodexItem {
  id?: string
  /** Older codex builds used `item_type`; newer (0.111+) emit `type`. */
  item_type?: string
  type?: string
  text?: string
  // function_call / tool_call
  name?: string
  arguments?: unknown
  call_id?: string
  // function_call_output / tool_result
  output?: unknown
  // command_execution
  command?: string | string[]
  exit_code?: number
  // file_change
  path?: string
  [extra: string]: unknown
}

export function mapCodexEvent(ev: CodexEvent): ProviderEvent[] {
  if (ev.type === 'item.completed' && ev.item) {
    return mapCodexItem(ev.item)
  }
  if (ev.type === 'turn.completed' && ev.usage) {
    return [{
      type: 'usage',
      inputTokens: ev.usage.input_tokens ?? 0,
      outputTokens: ev.usage.output_tokens ?? 0,
      cacheReadTokens: ev.usage.cached_input_tokens,
    }]
  }
  return []
}

function mapCodexItem(item: CodexItem): ProviderEvent[] {
  // 0.111+ renamed the discriminator from `item_type` to `type` and the
  // assistant-message value from `assistant_message` to `agent_message`.
  // Accept both so the parser keeps working across CLI bumps.
  const kind = item.item_type ?? item.type
  if ((kind === 'assistant_message' || kind === 'agent_message') && typeof item.text === 'string') {
    return [{ type: 'text', text: item.text }]
  }
  // Function / tool calls. Codex names these `function_call` (OpenAI-style)
  // but `tool_call` shows up in some versions too. The id field is named
  // `id` on the call and `call_id` on the result — pair on the latter.
  if ((kind === 'function_call' || kind === 'tool_call') && typeof item.id === 'string' && typeof item.name === 'string') {
    return [{
      type: 'tool_call',
      id: item.id,
      name: item.name,
      input: parseMaybeJson(item.arguments) ?? {},
    }]
  }
  if ((kind === 'function_call_output' || kind === 'tool_result') && typeof item.call_id === 'string') {
    return [{
      type: 'tool_result',
      toolUseId: item.call_id,
      content: coerceToString(item.output),
      isError: typeof item.exit_code === 'number' && item.exit_code !== 0 ? true : undefined,
    }]
  }
  // Shell commands surface as a tool_call/result pair so the work-stream
  // shows them inline. Use the item.id (or a stable synthesized id) so the
  // UI can pair them if codex emits both phases.
  if (kind === 'command_execution' && typeof item.command !== 'undefined') {
    const cmd = Array.isArray(item.command) ? item.command.join(' ') : String(item.command)
    const callId = typeof item.id === 'string' ? item.id : `cmd-${cmd.slice(0, 16)}`
    const events: ProviderEvent[] = [{
      type: 'tool_call',
      id: callId,
      name: 'Bash',
      input: { command: cmd },
    }]
    if (typeof item.output !== 'undefined') {
      events.push({
        type: 'tool_result',
        toolUseId: callId,
        content: coerceToString(item.output),
        isError: typeof item.exit_code === 'number' && item.exit_code !== 0 ? true : undefined,
      })
    }
    return events
  }
  if (kind === 'file_change' && typeof item.path === 'string') {
    const callId = typeof item.id === 'string' ? item.id : `fc-${item.path}`
    return [{
      type: 'tool_call',
      id: callId,
      name: 'Edit',
      input: { file_path: item.path },
    }]
  }
  return []
}

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return v }
}

function coerceToString(v: unknown): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  try { return JSON.stringify(v) } catch { return String(v) }
}
