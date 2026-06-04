/**
 * Base class for "local CLI" providers — claude-local, codex-local,
 * opencode-local. These don't speak HTTP wire formats; instead, the browser
 * asks the Annotask dev server to spawn the user's locally-installed CLI in
 * headless JSON mode and pipes the user's message in on stdin. The CLI
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

    let response: Response
    try {
      response = await this.fetchImpl(this.spawnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(spawn),
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

/** Flatten the provider-agnostic message history into a single prompt string. */
export function flattenMessagesAsPrompt(
  messages: ProviderMessage[],
  systemPrompt: string,
): string {
  const parts: string[] = []
  if (systemPrompt) parts.push(systemPrompt, '')
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      parts.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      continue
    }
    const text: string[] = []
    for (const block of msg.content) {
      if (block.type === 'text') text.push(block.text)
    }
    if (text.length > 0) {
      parts.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${text.join('')}`)
    }
  }
  return parts.join('\n').trim()
}

/**
 * Prepend a system prompt to a positional CLI prompt. Used by CLIs whose
 * headless modes don't expose a separate system-prompt flag (`codex exec`,
 * `opencode run`). The CLI receives one prompt that opens with the system
 * instructions, a separator, then the user turn — the model still picks up
 * the instructions even though everything is technically one user message.
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
 * multi-turn protocol — `codex exec`, `opencode run`. Multi-turn context can
 * still be expressed by prepending the rolled-up history.
 */
export function lastUserMessageText(messages: ProviderMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') return m.content
    const text: string[] = []
    for (const block of m.content) {
      if (block.type === 'text') text.push(block.text)
    }
    return text.join('')
  }
  return ''
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
