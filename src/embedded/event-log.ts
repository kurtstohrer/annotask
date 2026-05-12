/**
 * Local-only provider event log.
 *
 * Captures one row per provider turn (and per tool call) for inspection in
 * the AI settings panel and to support debugging. Strict requirements:
 *
 * 1. **No network egress.** This module is forbidden from making any
 *    `fetch`/XHR/network call. It writes to an in-memory ring buffer that
 *    can optionally persist into `localStorage` (caller-controlled).
 * 2. **Bounded memory.** Old rows are evicted when the buffer cap is hit,
 *    so a long session can't grow without bound.
 * 3. **No secret leakage.** Rows store counts and labels, not message
 *    bodies. Tool-call arguments are recorded as a JSON sketch (top-level
 *    keys only) — never the full payload.
 *
 * The log is meant for the user — never for telemetry to a hosted server.
 */

export type ProviderEventKind = 'turn' | 'tool_call' | 'tool_result' | 'error'

export interface BaseEventRow {
  /** Monotonic id assigned on append. */
  id: number
  /** Wall-clock timestamp (ms since epoch) of the recorded event. */
  ts: number
  /** Conversation/task this event belongs to. */
  conversationId: string
  kind: ProviderEventKind
}

export interface TurnEventRow extends BaseEventRow {
  kind: 'turn'
  provider: string
  model: string
  /** Tokens billed at the standard input rate. */
  inputTokens: number
  /** Tokens billed at the output rate. */
  outputTokens: number
  /** Cache-read tokens, when the provider exposes them. */
  cacheReadTokens?: number
  /** Cache-write tokens, when the provider exposes them. */
  cacheCreationTokens?: number
  /** Wall-clock latency, in milliseconds, from request to terminal event. */
  latencyMs: number
  /** Optional reason emitted by the provider (`'end_turn'`, `'tool_use'`, …). */
  stopReason?: string
}

export interface ToolCallEventRow extends BaseEventRow {
  kind: 'tool_call'
  provider: string
  model: string
  /** Tool name the model invoked. */
  toolName: string
  /** Provider tool-call id, so we can pair the eventual `tool_result`. */
  toolUseId: string
  /** Top-level keys of the tool input. Never the values. */
  inputKeys: string[]
}

export interface ToolResultEventRow extends BaseEventRow {
  kind: 'tool_result'
  toolUseId: string
  toolName: string
  /** True iff the tool reported an error rather than a normal result. */
  isError: boolean
  /** Wall-clock latency from `tool_call` append to `tool_result` append. */
  latencyMs: number
}

export interface ErrorEventRow extends BaseEventRow {
  kind: 'error'
  provider: string
  model: string
  /** Short label (`network`, `rate_limit`, `cap_exceeded`, …). */
  reason: string
  /** Optional human-readable detail. Already-redacted. */
  detail?: string
}

export type EventRow = TurnEventRow | ToolCallEventRow | ToolResultEventRow | ErrorEventRow

export type EventInput =
  | (Omit<TurnEventRow, 'id' | 'ts'> & { ts?: number })
  | (Omit<ToolCallEventRow, 'id' | 'ts'> & { ts?: number })
  | (Omit<ToolResultEventRow, 'id' | 'ts'> & { ts?: number })
  | (Omit<ErrorEventRow, 'id' | 'ts'> & { ts?: number })

export interface EventLogOptions {
  /** Max rows held in memory. Older rows are dropped. Defaults to 500. */
  capacity?: number
  /**
   * Optional sink for persisted reads/writes. Pass `localStorage` in the
   * shell; tests can pass an in-memory shim or omit entirely.
   */
  persistence?: PersistenceSink
  /** Persistence storage key. Defaults to `annotask:ai:eventLog`. */
  persistenceKey?: string
  /** Clock injection seam for deterministic tests. Defaults to `Date.now`. */
  now?: () => number
}

export interface PersistenceSink {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const DEFAULT_CAPACITY = 500
const DEFAULT_PERSISTENCE_KEY = 'annotask:ai:eventLog'

export class EventLog {
  private rows: EventRow[] = []
  private nextId = 1
  private listeners = new Set<(rows: ReadonlyArray<EventRow>) => void>()
  private readonly capacity: number
  private readonly persistence?: PersistenceSink
  private readonly persistenceKey: string
  private readonly now: () => number

  constructor(options: EventLogOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY
    if (!(this.capacity > 0)) {
      throw new Error(`EventLog: capacity must be > 0, got ${this.capacity}`)
    }
    this.persistence = options.persistence
    this.persistenceKey = options.persistenceKey ?? DEFAULT_PERSISTENCE_KEY
    this.now = options.now ?? (() => Date.now())
    this.hydrate()
  }

  append(event: EventInput): EventRow {
    const row = {
      ...(event as object),
      id: this.nextId++,
      ts: event.ts ?? this.now(),
    } as EventRow
    this.rows.push(row)
    if (this.rows.length > this.capacity) {
      // Drop the oldest rows. We drop from the front rather than mutating
      // in-place so the listeners always see a stable list.
      this.rows = this.rows.slice(this.rows.length - this.capacity)
    }
    this.persist()
    this.notify()
    return row
  }

  /**
   * Idiomatic helper for the runner: builds a `tool_call` row with the
   * top-level argument keys captured for inspection.
   */
  appendToolCall(args: {
    conversationId: string
    provider: string
    model: string
    toolName: string
    toolUseId: string
    input: unknown
  }): ToolCallEventRow {
    const inputKeys =
      args.input && typeof args.input === 'object' && !Array.isArray(args.input)
        ? Object.keys(args.input as Record<string, unknown>)
        : []
    return this.append({
      kind: 'tool_call',
      conversationId: args.conversationId,
      provider: args.provider,
      model: args.model,
      toolName: args.toolName,
      toolUseId: args.toolUseId,
      inputKeys,
    }) as ToolCallEventRow
  }

  list(): ReadonlyArray<EventRow> {
    return this.rows
  }

  /**
   * Filter helper used by the AI panel's "Activity" view.
   */
  filter(predicate: (row: EventRow) => boolean): ReadonlyArray<EventRow> {
    return this.rows.filter(predicate)
  }

  clear(): void {
    if (this.rows.length === 0) return
    this.rows = []
    this.persist()
    this.notify()
  }

  /**
   * Subscribe to log updates. Returns an unsubscribe function. The
   * listener is called with the new row list after every append/clear.
   */
  subscribe(listener: (rows: ReadonlyArray<EventRow>) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Aggregate totals across all `turn` rows. Useful for the per-task token
   * meter in the composer (`ProviderEvent.usage`-style readout).
   */
  totalsByConversation(conversationId: string): {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    turns: number
  } {
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheCreationTokens = 0
    let turns = 0
    for (const row of this.rows) {
      if (row.kind !== 'turn' || row.conversationId !== conversationId) continue
      inputTokens += row.inputTokens
      outputTokens += row.outputTokens
      cacheReadTokens += row.cacheReadTokens ?? 0
      cacheCreationTokens += row.cacheCreationTokens ?? 0
      turns += 1
    }
    return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, turns }
  }

  private persist(): void {
    if (!this.persistence) return
    try {
      this.persistence.setItem(this.persistenceKey, JSON.stringify({
        nextId: this.nextId,
        rows: this.rows,
      }))
    } catch {
      // Persistence is best-effort — quota or serialization errors must not
      // break the runner.
    }
  }

  private hydrate(): void {
    if (!this.persistence) return
    try {
      const raw = this.persistence.getItem(this.persistenceKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as { nextId?: number; rows?: EventRow[] }
      if (Array.isArray(parsed.rows)) {
        this.rows = parsed.rows.slice(-this.capacity)
      }
      if (typeof parsed.nextId === 'number' && parsed.nextId > this.nextId) {
        this.nextId = parsed.nextId
      }
    } catch {
      // Corrupt persisted state — discard and start clean.
      this.persistence.removeItem(this.persistenceKey)
    }
  }

  private notify(): void {
    if (this.listeners.size === 0) return
    const snapshot = this.rows
    for (const l of this.listeners) {
      try {
        l(snapshot)
      } catch {
        // Listener failure must not break appends.
      }
    }
  }
}
