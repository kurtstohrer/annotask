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
  lastUserMessageText,
  withSystemPrompt,
  type ParsedLineResult,
  type SpawnRequest,
} from './cli-local-provider.js'
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
    // own help. `--no-ask-user` keeps the agent from synthesising clarifying
    // questions that have nowhere to go in headless mode.
    const args = ['--output-format', 'json', '--allow-all-tools', '--no-ask-user']
    if (this.model) args.push('--model', this.model)
    // Map effort. Copilot exposes "low" | "medium" | "high" | "xhigh".
    if (options.effort && options.effort !== 'auto' && options.effort !== 'minimal') {
      args.push('--reasoning-effort', options.effort)
    }
    args.push(...this.extraArgs)
    // Copilot consumes the prompt via `-p <text>`. Prepend the system prompt
    // since there's no separate system-prompt flag.
    args.push('-p', withSystemPrompt(lastUserMessageText(messages), options.systemPrompt))
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
  /** Token count reported on the final message. Copilot only surfaces output
   *  tokens at this layer — there's no input-token count on the CLI side. */
  outputTokens?: number
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
  // Per-message output-token count. Input tokens aren't exposed by the CLI;
  // leave inputTokens at 0 and let the cumulative tally surface output only.
  if (ev.type === 'assistant.message' && data && typeof data.outputTokens === 'number') {
    out.push({ type: 'usage', inputTokens: 0, outputTokens: data.outputTokens })
  }
  // No usage info beyond what's already surfaced on `assistant.message`. The
  // `result` event carries timing + premiumRequests but no token totals.
  return out
}

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return v }
}
