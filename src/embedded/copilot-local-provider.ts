/**
 * GitHub Copilot CLI (local) provider.
 *
 * Spawns `copilot -p <prompt> --output-format json --allow-all-tools
 * --no-ask-user` and parses the JSONL event stream on stdout. Auth lives in
 * `~/.copilot/`; the user must have signed in via `copilot` before.
 *
 * NOT the same thing as `CopilotProvider` (in `copilot-provider.ts`), which
 * talks to `api.githubcopilot.com` over HTTP using the `gh` CLI's OAuth
 * token. This file wraps the first-party Copilot CLI as a local subprocess
 * and is registered as provider id `'copilot-local'`.
 *
 * Reference event shapes (copilot 1.0.48):
 *   {"type":"assistant.message_delta","data":{"deltaContent":"ok", ...}}
 *   {"type":"assistant.message","data":{"content":"ok","outputTokens":21,...}}
 *   {"type":"result","usage":{...}}
 *
 * Many other event types (session.*, user.message, assistant.turn_start,
 * assistant.reasoning, …) are surfaced too but carry no user-visible payload;
 * we ignore them silently rather than fail.
 */

import {
  CliLocalProvider,
  rollupHistoryAsPrompt,
  type ParsedLineResult,
  type SpawnRequest,
} from './cli-local-provider.js'
import { copilotPermissionFlags, defaultPermissionModeFor } from './permission-mode-flags.js'
import type {
  ProviderEvent,
  ProviderMessage,
  ProviderTool,
  StreamOptions,
} from './provider.js'

export interface CopilotLocalProviderOptions {
  /** Optional model id passed to `copilot --model`. */
  model?: string
  extraArgs?: string[]
  spawnUrl?: string
  fetchImpl?: typeof fetch
}

export class CopilotLocalProvider extends CliLocalProvider {
  private readonly model?: string
  private readonly extraArgs: string[]

  constructor(opts: CopilotLocalProviderOptions = {}) {
    super({
      name: 'copilot-local',
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
    // `--allow-all-tools` is required for `-p` (non-interactive) per the CLI's
    // own help — so even non-bypass modes keep it. `bypass` additionally
    // enables `--allow-all` (paths + URLs + tools); weaker modes stop at the
    // minimum required for headless to run. Per-action approval is not
    // possible in `copilot -p`; surface this limitation in the UI.
    const args = ['--output-format', 'json']
    args.push(...copilotPermissionFlags(options.permissionMode ?? defaultPermissionModeFor('copilot')))
    if (this.model) args.push('--model', this.model)
    // Map effort. Copilot exposes "low" | "medium" | "high" | "xhigh".
    if (options.effort && options.effort !== 'auto' && options.effort !== 'minimal') {
      args.push('--reasoning-effort', options.effort)
    }
    args.push(...this.extraArgs)
    // Copilot consumes the prompt via `-p <text>`. Prepend the system prompt
    // (there's no separate system-prompt flag) and roll up the prior turns
    // as a transcript — each turn spawns a fresh `copilot -p` with no
    // session memory of its own.
    args.push('-p', rollupHistoryAsPrompt(messages, options.systemPrompt))
    return { cli: 'copilot', args }
  }

  protected parseStdoutLine(line: string): ParsedLineResult {
    const trimmed = line.trim()
    if (!trimmed) return []
    let event: CopilotCliEvent
    try { event = JSON.parse(trimmed) as CopilotCliEvent }
    catch { return [] }
    return mapCopilotEvent(event)
  }
}

export interface CopilotCliEvent {
  type?: string
  data?: CopilotEventData
  usage?: CopilotResultUsage
  [extra: string]: unknown
}

interface CopilotEventData {
  /** Streaming chunk text. */
  deltaContent?: string
  /** Final cumulative message content. */
  content?: string
  /** Token counts reported on the final message. Copilot historically surfaces
   *  only output tokens at this layer; we read input/cache too if a newer CLI
   *  starts emitting them rather than hardcoding the input side to 0. */
  outputTokens?: number
  inputTokens?: number
  cacheReadTokens?: number
  /** Tool requests embedded on the final assistant message. Each one
   *  describes a tool the model wants to invoke. */
  toolRequests?: CopilotToolRequest[]
  [extra: string]: unknown
}

interface CopilotToolRequest {
  id?: string
  name?: string
  arguments?: unknown
}

interface CopilotResultUsage {
  premiumRequests?: number
  totalApiDurationMs?: number
  sessionDurationMs?: number
}

export function mapCopilotEvent(ev: CopilotCliEvent): ProviderEvent[] {
  const out: ProviderEvent[] = []
  const data = ev.data ?? undefined

  // Streaming text deltas. message_delta is the per-chunk surface; assistant
  // .message at end-of-turn carries the full content but emitting it would
  // duplicate the deltas, so we only read outputTokens off of it.
  if (ev.type === 'assistant.message_delta' && data && typeof data.deltaContent === 'string' && data.deltaContent.length > 0) {
    out.push({ type: 'text', text: data.deltaContent })
  }
  // Fallback: a stream that emitted only a final assistant.message with no
  // deltas (some agent modes do this). Surface its content as one text event
  // so the user still sees the reply.
  if (ev.type === 'assistant.message' && data && typeof data.content === 'string' && data.content.length > 0) {
    // Only emit if no prior delta carried text — we can't know here, so the
    // safest behavior is to always emit. The base class concatenates text
    // events into a single block in the UI; duplicate text would surface as
    // doubled content. Copilot's contract today (1.0.48) is to emit deltas
    // AND a final message, so we skip emitting text from `assistant.message`
    // and rely on deltas. Tool requests on the final message still need to
    // be surfaced — see below.
  }
  if (ev.type === 'assistant.message' && data && Array.isArray(data.toolRequests)) {
    for (const tr of data.toolRequests) {
      if (typeof tr.id !== 'string' || typeof tr.name !== 'string') continue
      out.push({
        type: 'tool_call',
        id: tr.id,
        name: tr.name,
        input: parseMaybeJson(tr.arguments) ?? {},
      })
    }
  }
  // Per-message token counts. Older copilot CLIs surface only outputTokens
  // (inputTokens stays 0 — the cost meter undercounts input on those); newer
  // ones may add input/cache, which we pick up here instead of dropping.
  if (ev.type === 'assistant.message' && data && (typeof data.outputTokens === 'number' || typeof data.inputTokens === 'number')) {
    out.push({
      type: 'usage',
      inputTokens: typeof data.inputTokens === 'number' ? data.inputTokens : 0,
      outputTokens: typeof data.outputTokens === 'number' ? data.outputTokens : 0,
      ...(typeof data.cacheReadTokens === 'number' ? { cacheReadTokens: data.cacheReadTokens } : {}),
    })
  }
  // No usage info beyond what's already surfaced on `assistant.message`. The
  // `result` event carries timing + premiumRequests but no token totals.
  return out
}

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return v }
}
