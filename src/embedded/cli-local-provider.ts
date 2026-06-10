/**
 * Base class for "local CLI" providers — claude-local, codex-local,
 * opencode-local, copilot-local. These don't speak HTTP wire formats;
 * instead, the browser asks the Annotask dev server to spawn the user's
 * locally-installed CLI in headless JSON mode and pipes the user's message
 * in on stdin. The CLI
 * streams JSON events back on stdout, which the server forwards as SSE,
 * which this provider parses into the shared `ProviderEvent` shape.
 *
 * Why this lives in the browser at all (instead of the server):
 *   - Provider config (active model, extra args) is browser state.
 *   - The transcript UI subscribes to `provider.stream()` directly; only the
 *     transport (subprocess) requires server help.
 *   - This keeps the LLMProvider contract uniform across direct-API and
 *     local-CLI providers — `useEmbeddedAgent` doesn't care which kind ran.
 *
 * Wire contract with /__annotask/api/agent/spawn:
 *   POST { cli, args, stdin? } → text/event-stream
 *     event: stdout   data: <one line of CLI stdout>
 *     event: stderr   data: <one line of CLI stderr>
 *     event: exit     data: { code: number, signal: string|null }
 *     event: error    data: <string>
 *
 * Each subclass implements `buildSpawn()` (how to invoke the CLI for the
 * given prompt) and `parseStdoutLine()` (how to map one JSON line to zero or
 * more ProviderEvents).
 */

import type {
  LLMProvider,
  ProviderMessage,
  ProviderTool,
  ProviderEvent,
  StreamOptions,
} from './provider.js'

/** Shape returned by the server when spawning a CLI. */
export interface SpawnRequest {
  /** Allow-listed CLI binary name. */
  cli: 'claude' | 'codex' | 'opencode' | 'copilot'
  /** Argv after the cli name. No shell quoting needed; passed straight to spawn. */
  args: string[]
  /** Optional stdin body; written to the child's stdin then EOF. */
  stdin?: string
  /** Optional extra environment variables, merged over the dev server's env. */
  env?: Record<string, string>
}

export interface CliLocalProviderConfig {
  /** Stable identifier for telemetry/UI labels. */
  name: string
  /**
   * Endpoint the browser should hit to spawn the CLI. Defaults to
   * `/__annotask/api/agent/spawn`; tests can inject a mock transport.
   */
  spawnUrl?: string
  /** Test seam: inject a custom fetch implementation. */
  fetchImpl?: typeof fetch
}

/**
 * Conversion result for one stdout line. Subclasses return zero events for
 * "no payload" (headers, blank lines), one or more for real chunks. The base
 * class emits its own `usage` and `done` at end-of-stream, so subclasses
 * SHOULD NOT emit `done` themselves — they may emit `usage` early if the
 * CLI reports it inline.
 */
export type ParsedLineResult = ProviderEvent[]

export abstract class CliLocalProvider implements LLMProvider {
  readonly name: string
  private readonly spawnUrl: string
  private readonly fetchImpl: typeof fetch
  private lastRunId: string | null = null

  constructor(cfg: CliLocalProviderConfig) {
    this.name = cfg.name
    this.spawnUrl = cfg.spawnUrl ?? '/__annotask/api/agent/spawn'
    this.fetchImpl = cfg.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  /** Explicitly kill a running subprocess via the server's abort endpoint. */
  async abortRun(): Promise<void> {
    const runId = this.lastRunId
    if (!runId) return
    this.lastRunId = null
    try {
      await this.fetchImpl(`${this.spawnUrl}/${encodeURIComponent(runId)}`, { method: 'DELETE' })
    } catch { /* best effort */ }
  }

  /** Build the CLI spawn request for this conversation turn. */
  protected abstract buildSpawn(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    options: StreamOptions,
  ): SpawnRequest

  /** Parse one stdout line (one JSON event). Return zero or more ProviderEvents. */
  protected abstract parseStdoutLine(line: string): ParsedLineResult

  /** Subclass hook: called when the CLI exits non-zero. Default: emit an error. */
  protected onCliError(stderr: string, exitCode: number | null): ProviderEvent {
    const msg = stderr.trim() || `CLI exited with code ${exitCode ?? 'unknown'}`
    return { type: 'error', error: `[${this.name}] ${msg}` }
  }

  async *stream(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    options: StreamOptions,
  ): AsyncIterable<ProviderEvent> {
    if (options.signal?.aborted) {
      yield { type: 'done', stopReason: 'aborted' }
      return
    }

    const spawn = this.buildSpawn(messages, tools, options)
    // Forward the task id (when this run is applying one) so the server can key
    // its run registry by task — dedup cross-tab runs + finalize orphans.
    const spawnBody = options.taskId ? { ...spawn, taskId: options.taskId } : spawn

    let response: Response
    try {
      response = await this.fetchImpl(this.spawnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(spawnBody),
        signal: options.signal,
      })
    } catch (err) {
      yield { type: 'error', error: `[${this.name}] spawn fetch failed: ${(err as Error).message}` }
      yield { type: 'done', stopReason: 'error' }
      return
    }

    if (!response.ok) {
      const text = await safeReadText(response)
      yield {
        type: 'error',
        error: `[${this.name}] spawn HTTP ${response.status}: ${text || response.statusText}`,
      }
      yield { type: 'done', stopReason: 'error' }
      return
    }
    if (!response.body) {
      yield { type: 'error', error: `[${this.name}] spawn response has no body` }
      yield { type: 'done', stopReason: 'error' }
      return
    }

    let exitCode: number | null = null
    let stderrBuffer = ''
    let stopReason: string | undefined
    let usageEmitted = false
    this.lastRunId = null

    try {
      for await (const ev of iterateSse(response.body, options.signal)) {
        if (ev.event === 'run') {
          // Capture the server-assigned run ID so abortRun() can kill it.
          try {
            const parsed = JSON.parse(ev.data) as { runId?: string }
            if (parsed.runId) this.lastRunId = parsed.runId
          } catch { /* ignore */ }
        } else if (ev.event === 'stdout') {
          for (const out of this.parseStdoutLine(ev.data)) {
            if (out.type === 'usage') usageEmitted = true
            yield out
          }
        } else if (ev.event === 'stderr') {
          // Buffer stderr — only surface if the process exits non-zero.
          stderrBuffer += ev.data + '\n'
        } else if (ev.event === 'exit') {
          try {
            const parsed = JSON.parse(ev.data) as { code?: number | null }
            exitCode = typeof parsed.code === 'number' ? parsed.code : null
          } catch { /* ignore */ }
        } else if (ev.event === 'error') {
          yield { type: 'error', error: `[${this.name}] ${ev.data}` }
          stopReason = 'error'
        }
      }
    } catch (err) {
      yield { type: 'error', error: (err as Error).message ?? String(err) }
      stopReason = 'error'
    }
    this.lastRunId = null

    if (options.signal?.aborted) stopReason = 'aborted'
    else if (exitCode !== null && exitCode !== 0) {
      yield this.onCliError(stderrBuffer, exitCode)
      stopReason = stopReason ?? 'error'
    }

    if (!usageEmitted) {
      // Subclasses that don't surface usage still need a `usage` event so the
      // cost meter doesn't show a phantom zero forever.
      yield { type: 'usage', inputTokens: 0, outputTokens: 0 }
    }
    yield { type: 'done', stopReason }
  }
}

/** Extract the text payload of one provider message. Tool blocks have no
 *  positional-prompt representation here — by the time a thread message
 *  reaches a provider its `content` already carries the flat text rollup
 *  (including `[Tool] …` / `[Result] …` summary lines), so text blocks are
 *  the only thing worth reading. */
function messageText(msg: ProviderMessage): string {
  if (typeof msg.content === 'string') return msg.content
  const text: string[] = []
  for (const block of msg.content) {
    if (block.type === 'text') text.push(block.text)
  }
  return text.join('')
}

/** Flatten the provider-agnostic message history into a single prompt string. */
export function flattenMessagesAsPrompt(
  messages: ProviderMessage[],
  systemPrompt: string,
): string {
  const parts: string[] = []
  if (systemPrompt) parts.push(systemPrompt, '')
  for (const msg of messages) {
    const text = messageText(msg)
    if (text.length > 0) {
      parts.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${text}`)
    }
  }
  return parts.join('\n').trim()
}

/**
 * Prepend a system prompt to a positional CLI prompt. Used by CLIs whose
 * headless modes don't expose a separate system-prompt flag (`codex exec`,
 * `opencode run`, `copilot -p`). The CLI receives one prompt that opens with
 * the system instructions, a separator, then the user turn — the model still
 * picks up the instructions even though everything is technically one user
 * message.
 *
 * `claude --print` already supports a real system prompt via stdin's flatten
 * helper above, so it doesn't go through this.
 */
export function withSystemPrompt(userText: string, systemPrompt: string): string {
  const trimmed = systemPrompt.trim()
  if (trimmed.length === 0) return userText
  return `${trimmed}\n\n---\n\n${userText}`
}

/**
 * Extract just the latest user turn as a single string. Used by CLIs whose
 * headless mode runs one-shot ("answer this one prompt") rather than a true
 * multi-turn protocol — `codex exec`, `opencode run`, `copilot -p`.
 * Multi-turn context is expressed by prepending the rolled-up history — see
 * `rollupHistoryAsPrompt` below.
 */
export function lastUserMessageText(messages: ProviderMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    return messageText(m)
  }
  return ''
}

/**
 * Character budget for prompts passed as a single argv element. Linux caps
 * one argv string at MAX_ARG_STRLEN (128 KiB) and macOS shares a 1 MiB
 * ARG_MAX across the whole argv + environment — 100 KB leaves comfortable
 * headroom for the rest of the command line on both. claude isn't affected
 * (its prompt rides on stdin), only the positional-prompt CLIs are.
 */
export const POSITIONAL_PROMPT_MAX_CHARS = 100_000

/** Inserted at the top of the rolled-up transcript when old turns were
 *  dropped, so the model knows the history is incomplete rather than
 *  inventing the missing context. */
export const HISTORY_TRUNCATED_MARKER = '[earlier turns truncated]'

/**
 * Roll up the full conversation into a single positional prompt for one-shot
 * CLIs (`codex exec`, `opencode run`, `copilot -p`). Each chat turn spawns a
 * fresh subprocess, so without this every follow-up message would lose ALL
 * prior context — the rolled-up history is the only memory these CLIs get.
 *
 * Shape (system prompt first so it reads as instructions, then the prior
 * turns as a clearly-delimited transcript, then the live request):
 *
 *   <system prompt>
 *   ---
 *   ## Conversation so far
 *   User: …
 *   Assistant: …
 *   ## Current request
 *   <latest user message>
 *
 * First turns (no prior history) keep the exact single-shot shape of
 * `withSystemPrompt(lastUserMessageText(...), ...)` so seed-run prompts are
 * byte-identical to what they were before multi-turn support.
 *
 * Budget: the whole prompt must fit in one argv element (see
 * `POSITIONAL_PROMPT_MAX_CHARS`). The system prompt and the current request
 * are never truncated — history turns are dropped OLDEST-first until the
 * rest fits, with `HISTORY_TRUNCATED_MARKER` left where they were.
 */
export function rollupHistoryAsPrompt(
  messages: ProviderMessage[],
  systemPrompt: string,
  maxChars: number = POSITIONAL_PROMPT_MAX_CHARS,
): string {
  // The current turn is the LAST user message; everything before it is
  // prior conversation. (Messages after it shouldn't exist — the runner
  // always appends the user turn last before streaming.)
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break }
  }
  const current = lastUserIdx >= 0 ? messageText(messages[lastUserIdx]) : ''
  if (lastUserIdx <= 0) {
    return withSystemPrompt(current, systemPrompt)
  }

  const turns: string[] = []
  for (let i = 0; i < lastUserIdx; i++) {
    const m = messages[i]
    const text = messageText(m).trim()
    if (text.length === 0) continue
    turns.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${text}`)
  }
  if (turns.length === 0) {
    return withSystemPrompt(current, systemPrompt)
  }

  const heading = '## Conversation so far'
  const currentHeading = '## Current request'
  // Fixed cost = everything that survives no matter what: system prompt,
  // both headings, the current request, plus reserved room for the
  // truncation marker (cheaper to always reserve its ~30 chars than to
  // re-balance the budget when truncation kicks in).
  const fixedCost = withSystemPrompt(
    [heading, '', currentHeading, '', current].join('\n'),
    systemPrompt,
  ).length + HISTORY_TRUNCATED_MARKER.length + 2
  let remaining = maxChars - fixedCost

  // Walk history NEWEST-first so the budget keeps the most recent turns;
  // the first turn that doesn't fit ends the walk (skipping it but keeping
  // older turns would scramble the transcript's continuity).
  const kept: string[] = []
  let truncated = false
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = turns[i].length + 2 // +2 for the blank-line separator
    if (cost > remaining) { truncated = true; break }
    kept.unshift(turns[i])
    remaining -= cost
  }
  if (truncated) kept.unshift(HISTORY_TRUNCATED_MARKER)

  const body = [heading, '', kept.join('\n\n'), '', currentHeading, '', current].join('\n')
  return withSystemPrompt(body, systemPrompt)
}

/** Parsed SSE event from the spawn endpoint. */
interface SseEvent {
  event: string
  data: string
}

/**
 * Parse a stream of SSE frames from the spawn endpoint. Each frame is a
 * `event:` + `data:` pair, separated by blank lines. We ignore comment lines
 * (`:` prefix) and id lines — the spawn endpoint never uses them.
 */
async function* iterateSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): AsyncIterable<SseEvent> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''
  let currentEvent = 'message'
  let currentData: string[] = []

  try {
    for (;;) {
      if (signal?.aborted) break
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const rawLine = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)

        if (rawLine === '') {
          if (currentData.length > 0) {
            yield { event: currentEvent, data: currentData.join('\n') }
          }
          currentEvent = 'message'
          currentData = []
          continue
        }
        if (rawLine.startsWith(':')) continue // comment line
        const colon = rawLine.indexOf(':')
        if (colon < 0) continue
        const field = rawLine.slice(0, colon)
        const value = rawLine.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') currentEvent = value
        else if (field === 'data') currentData.push(value)
      }
    }
    // flush trailing event if the stream ended without a blank line
    if (currentData.length > 0) {
      yield { event: currentEvent, data: currentData.join('\n') }
    }
  } finally {
    try { await reader.cancel() } catch { /* ignore */ }
  }
}

async function safeReadText(response: Response): Promise<string> {
  try { return (await response.text()).slice(0, 1024) }
  catch { return '' }
}
