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
 *
 * Session resume: when `options.resumeSessionId` is set, subclasses build
 * their CLI's native resume argv (`claude --resume`, `codex exec resume`,
 * `opencode run --session`, `copilot --resume`) and send ONLY the latest user
 * message — the session already holds the system prompt and prior turns. The
 * base class runs that as a guarded attempt and silently retries cold (full
 * history, no resume flag) when the attempt dies without producing content —
 * see `runSpawn`. Subclasses parse their CLI's session identifier into
 * `{ type: 'session', sessionId }` events so the runner can persist it.
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

    const wantResume = typeof options.resumeSessionId === 'string' && options.resumeSessionId.length > 0
    if (wantResume) {
      // Attempt 1: resume the CLI session — subclasses build the resume argv
      // and send only the latest user message. If the session is stale
      // (expired, pruned, wrong machine) the CLI dies fast without producing
      // content; retry cold with the full history so the turn still lands.
      // The cold spawn emits a fresh `session` event, so the caller's stored
      // id self-heals on the next turn.
      const outcome = yield* this.runSpawn(messages, tools, options, true)
      if (outcome !== 'fallback') return
      const cold: StreamOptions = { ...options, resumeSessionId: undefined }
      yield* this.runSpawn(messages, tools, cold, false)
      return
    }
    yield* this.runSpawn(messages, tools, options, false)
  }

  /**
   * One spawn attempt. Yields provider events as they stream.
   *
   * `isResumeAttempt` changes the failure contract: events are held back until
   * the first CONTENT event (text / tool_call / tool_result) proves the
   * session took. A resume attempt that dies contentless (non-zero exit or a
   * transport-level stderr error, and not user-aborted) yields NO terminal
   * events and returns `'fallback'` so the caller can silently retry cold.
   * Everything else — including the pre-spawn 409 `task_already_running` and
   * fetch/HTTP failures (a dead server fails cold spawns identically, so
   * retrying would only double the noise) — terminates normally with
   * `'done'`.
   */
  private async *runSpawn(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    options: StreamOptions,
    isResumeAttempt: boolean,
  ): AsyncGenerator<ProviderEvent, 'done' | 'fallback', void> {
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
      return 'done'
    }

    if (!response.ok) {
      const text = await safeReadText(response)
      // Cross-tab dedup: the server already has a live run for this task in
      // another tab/session (409 `task_already_running`). THIS run never
      // started, so it must not be treated as an error — an error reverts the
      // task to pending, which would yank the WINNING tab's live run out from
      // under it. Signal a benign, distinct stop reason and let the caller
      // leave the task status untouched.
      if (response.status === 409 && text.includes('task_already_running')) {
        yield { type: 'done', stopReason: 'already_running' }
        return 'done'
      }
      yield {
        type: 'error',
        error: `[${this.name}] spawn HTTP ${response.status}: ${text || response.statusText}`,
      }
      yield { type: 'done', stopReason: 'error' }
      return 'done'
    }
    if (!response.body) {
      yield { type: 'error', error: `[${this.name}] spawn response has no body` }
      yield { type: 'done', stopReason: 'error' }
      return 'done'
    }

    let exitCode: number | null = null
    let stderrBuffer = ''
    let stopReason: string | undefined
    let usageEmitted = false
    this.lastRunId = null

    // Resume attempts hold pre-content events (session ids, early usage) so a
    // failed attempt can be discarded wholesale — nothing from a stale-session
    // spawn may leak into the caller's timeline. The hold releases on the
    // first content event; from then on it's plain pass-through. Non-resume
    // spawns never hold (holding=false ⇒ byte-identical to the old behavior).
    let holding = isResumeAttempt
    let contentSeen = false
    const holdback: ProviderEvent[] = []
    const heldErrors: string[] = []
    const isContent = (e: ProviderEvent): boolean =>
      e.type === 'text' || e.type === 'tool_call' || e.type === 'tool_result'

    // Character counts backing the estimated-usage fallback below: what we
    // sent (stdin + argv — flags are noise next to the prompt) and the text
    // the CLI streamed back.
    const promptChars = (spawn.stdin?.length ?? 0) + spawn.args.reduce((n, a) => n + a.length + 1, 0)
    let textCharsOut = 0

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
            if (out.type === 'text') textCharsOut += out.text.length
            if (isContent(out)) contentSeen = true
            if (holding) {
              if (contentSeen) {
                holding = false
                for (const h of holdback) yield h
                holdback.length = 0
                for (const e of heldErrors) yield { type: 'error', error: `[${this.name}] ${e}` }
                heldErrors.length = 0
                yield out
              } else {
                holdback.push(out)
              }
            } else {
              yield out
            }
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
          if (holding) {
            heldErrors.push(ev.data)
          } else {
            yield { type: 'error', error: `[${this.name}] ${ev.data}` }
          }
          stopReason = 'error'
        }
      }
    } catch (err) {
      const msg = (err as Error).message ?? String(err)
      if (holding) heldErrors.push(msg)
      else yield { type: 'error', error: msg }
      stopReason = 'error'
    }
    this.lastRunId = null

    const aborted = options.signal?.aborted === true

    // Stale-session signature: the resume attempt produced no content and
    // ended badly (non-zero exit or a stream error) without the user aborting.
    // Suppress everything it held and let the caller retry cold.
    if (isResumeAttempt && !contentSeen && !aborted
      && (stopReason === 'error' || (exitCode !== null && exitCode !== 0))) {
      return 'fallback'
    }

    // A resume attempt that ended cleanly while still holding (content-free
    // but successful — e.g. only session/usage events) flushes its hold now.
    if (holding) {
      for (const h of holdback) yield h
      for (const e of heldErrors) yield { type: 'error', error: `[${this.name}] ${e}` }
    }

    if (aborted) stopReason = 'aborted'
    else if (exitCode !== null && exitCode !== 0) {
      yield this.onCliError(stderrBuffer, exitCode)
      stopReason = stopReason ?? 'error'
    }

    if (!usageEmitted) {
      // The CLI reported no usage at all (opencode legacy shapes, unknown
      // future CLIs). Estimate from character counts instead of recording a
      // systematic 0 — flagged `estimated` so the ledger/meter stay honest.
      yield {
        type: 'usage',
        inputTokens: estimateTokensFromChars(promptChars),
        outputTokens: estimateTokensFromChars(textCharsOut),
        estimated: true,
      }
    }
    yield { type: 'done', stopReason }
    return 'done'
  }
}

/**
 * Rough token estimate from character length (~3.6 chars/token for English
 * prose + code, mirroring the shell's pre-run cost-meter estimator). Used
 * when a CLI reports no (or partial) usage so the ledger records a value
 * closer to truth than a hard 0 — always paired with `estimated: true`.
 */
export function estimateTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0
  return Math.round(chars / 3.6)
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
 * `claude --print` doesn't go through this — its subclass uses
 * `flattenMessagesAsPrompt` on stdin instead. Note that is NOT a real system
 * prompt either: the CLI receives one user-message blob that merely opens
 * with the instructions. Moving claude to `--append-system-prompt` is
 * tracked as a follow-up (prompt-caching win).
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

/**
 * Character budget for prompts delivered over STDIN (no argv ceiling — the
 * bound here is model-context sanity, not the OS). Roughly 110K tokens of
 * history headroom before oldest-first truncation kicks in.
 */
export const STDIN_PROMPT_MAX_CHARS = 400_000

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
