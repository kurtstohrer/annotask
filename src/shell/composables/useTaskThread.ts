/**
 * Client for the per-task conversation thread endpoint.
 *
 * Wraps `GET/POST /__annotask/api/tasks/:id/messages` and the SSE stream at
 * `/messages/stream`. Returns a tiny reactive interface the Conversation tab
 * binds to:
 *
 *   const thread = useTaskThread()
 *   await thread.open(taskId)         // load snapshot + subscribe
 *   thread.messages.value             // ShallowRef<ThreadMessage[]>
 *   await thread.append({...})        // optimistic append
 *   thread.close()                    // unsubscribe on unmount
 *
 * The composable is *not* a singleton — each Conversation tab instance owns
 * its own subscriber, so opening two tasks at once doesn't cross-wire their
 * EventSource feeds. The store on the server is the single source of truth
 * (writes from MCP / CLI agents fan out to all open browser tabs).
 */

import { ref, shallowRef, computed, type Ref, type ShallowRef } from 'vue'
import type { WorkStreamBlock } from '../../shared/work-stream'

export type ThreadRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ThreadMessage {
  id: string
  ts: number
  role: ThreadRole
  content: string
  providerId?: string
  model?: string
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    /** Some counts were estimated from character length (CLI reported none). */
    estimated?: boolean
  }
  toolCalls?: Array<{ id: string; name: string; input: unknown }>
  toolUseId?: string
  /** CLI session id for local-CLI assistant turns — the next turn on this
   *  thread resumes it (`claude --resume <id>` etc.) instead of replaying the
   *  transcript. Paired with `providerId`; never resume across providers. */
  sessionId?: string
  /** Ordered work-stream timeline for the turn. Rendered by the rich UI. */
  blocks?: WorkStreamBlock[]
  /** True while the assistant turn is still streaming (updated in place). */
  isPartial?: boolean
  /** Wall-clock of the last streamed event for a partial turn. */
  lastEventAt?: number
}

export interface AppendInput {
  role: ThreadRole
  content: string
  providerId?: string
  model?: string
  usage?: ThreadMessage['usage']
  sessionId?: string
  blocks?: WorkStreamBlock[]
  isPartial?: boolean
  lastEventAt?: number
}

/** Patchable fields for an in-place message update (streaming a partial turn). */
export interface UpdateInput {
  content?: string
  blocks?: WorkStreamBlock[]
  usage?: ThreadMessage['usage']
  isPartial?: boolean
  lastEventAt?: number
  model?: string
  providerId?: string
  sessionId?: string
}

export type ThreadStatus = 'idle' | 'loading' | 'live' | 'error' | 'reconnecting'

const API_BASE = '/__annotask/api'

export interface UseTaskThread {
  /** Active task id this thread is bound to. */
  taskId: Ref<string | null>
  /** All messages received so far, in order. */
  messages: ShallowRef<ThreadMessage[]>
  /** Live status of the SSE connection. */
  status: Ref<ThreadStatus>
  /** Latest error string, when status is `error`. */
  error: Ref<string | null>
  /** Last seen message id — clients can pass this in `Last-Event-ID` on reconnect. */
  lastId: Ref<string | null>
  /** Open the thread for a task: load snapshot then subscribe to live updates. */
  open(taskId: string): Promise<void>
  /** Append a message via HTTP. Returns the persisted message. */
  append(input: AppendInput): Promise<ThreadMessage>
  /** Patch a message in place (by id). Returns the merged message. */
  update(id: string, patch: UpdateInput): Promise<ThreadMessage>
  /** Close the SSE stream. Safe to call repeatedly. */
  close(): void
}

export function useTaskThread(): UseTaskThread {
  const taskId = ref<string | null>(null)
  const messages = shallowRef<ThreadMessage[]>([])
  const status = ref<ThreadStatus>('idle')
  const error = ref<string | null>(null)
  const lastId = ref<string | null>(null)

  let es: EventSource | null = null
  // Generation counter — every open() bumps it. Late-arriving fetches from a
  // previous open() compare against the current generation and bail out.
  let generation = 0
  // Give-up after this many consecutive reconnect failures so the user gets an
  // actionable error instead of a silently-frozen timeline forever. Reset on a
  // successful (re)connect and on each fresh open().
  const MAX_RECONNECT_ATTEMPTS = 6
  let reconnectAttempts = 0

  function pushMessage(msg: ThreadMessage) {
    // Upsert by id. A partial assistant turn arrives once on append and then
    // repeatedly via update() / the SSE echo of each in-place rewrite —
    // replacing the existing entry lets the timeline grow live. For a brand
    // new id we append. (Also dedupes the SSE replay after a reconnect.)
    const idx = messages.value.findIndex((m) => m.id === msg.id)
    if (idx >= 0) {
      const next = messages.value.slice()
      next[idx] = msg
      messages.value = next
      return
    }
    messages.value = [...messages.value, msg]
    lastId.value = msg.id
  }

  function reset() {
    messages.value = []
    lastId.value = null
    error.value = null
  }

  function close() {
    if (es) {
      try { es.close() } catch { /* ignore */ }
      es = null
    }
    status.value = 'idle'
  }

  async function open(id: string): Promise<void> {
    const gen = ++generation
    close()
    taskId.value = id
    reset()
    reconnectAttempts = 0
    status.value = 'loading'
    try {
      const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}/messages`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { messages?: ThreadMessage[] }
      if (gen !== generation) return // raced with another open()
      const list = Array.isArray(body.messages) ? body.messages : []
      messages.value = list
      lastId.value = list.length > 0 ? list[list.length - 1].id : null
    } catch (err) {
      if (gen !== generation) return
      status.value = 'error'
      error.value = `Failed to load conversation: ${(err as Error).message}`
      return
    }

    // Subscribe to live updates. EventSource forwards Last-Event-ID itself
    // on reconnect; we seed the initial replay via `?after=` so the server
    // doesn't have to re-send what we already pulled in the snapshot.
    const url = `${API_BASE}/tasks/${encodeURIComponent(id)}/messages/stream${lastId.value ? `?after=${encodeURIComponent(lastId.value)}` : ''}`
    try {
      es = new EventSource(url)
    } catch (err) {
      status.value = 'error'
      error.value = `Failed to open stream: ${(err as Error).message}`
      return
    }
    es.addEventListener('message', (ev: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(ev.data) as ThreadMessage
        pushMessage(msg)
      } catch { /* ignore malformed frames */ }
    })
    es.addEventListener('open', () => { reconnectAttempts = 0; status.value = 'live'; error.value = null })
    es.addEventListener('error', () => {
      reconnectAttempts += 1
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        // Stop the indefinite silent reconnect and surface an actionable error.
        close()
        status.value = 'error'
        error.value = 'Lost connection to the conversation stream. Click retry.'
        return
      }
      // EventSource auto-reconnects; surface the state but don't tear down.
      status.value = 'reconnecting'
    })
  }

  async function append(input: AppendInput): Promise<ThreadMessage> {
    const id = taskId.value
    if (!id) throw new Error('Thread is not open')
    const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: input.role,
        content: input.content,
        providerId: input.providerId,
        model: input.model,
        usage: input.usage,
        sessionId: input.sessionId,
        blocks: input.blocks,
        isPartial: input.isPartial,
        lastEventAt: input.lastEventAt,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Append failed (HTTP ${res.status}): ${text.slice(0, 200)}`)
    }
    const msg = (await res.json()) as ThreadMessage
    // The SSE stream will also deliver this message (via the server's
    // broadcast) but the upsert in pushMessage tolerates both paths so the
    // composer can show it immediately without waiting for the round-trip.
    pushMessage(msg)
    return msg
  }

  async function update(id: string, patch: UpdateInput): Promise<ThreadMessage> {
    const tid = taskId.value
    if (!tid) throw new Error('Thread is not open')
    const res = await fetch(
      `${API_BASE}/tasks/${encodeURIComponent(tid)}/messages/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Update failed (HTTP ${res.status}): ${text.slice(0, 200)}`)
    }
    const msg = (await res.json()) as ThreadMessage
    pushMessage(msg)
    return msg
  }

  return { taskId, messages, status, error, lastId, open, append, update, close }
}

/**
 * Convenience: return the active provider config snapshot probe needed by
 * `useEmbeddedAgent` and the Conversation tab's empty state. Kept here so
 * the Conversation tab doesn't have to know about the agent-detect schema.
 */
export interface AgentDetectSnapshot {
  'claude-local': { found: boolean; loggedIn?: boolean; version?: string }
  'codex-local': { found: boolean; loggedIn?: boolean; version?: string }
  'opencode-local': { found: boolean; loggedIn?: boolean; version?: string }
  'copilot-local': { found: boolean; loggedIn?: boolean; version?: string }
  copilot: { found: boolean; loggedIn?: boolean; version?: string }
  openrouter: { hasEnv: boolean }
  ts: number
}

const detectCache = ref<AgentDetectSnapshot | null>(null)
const detectLoading = ref(false)

/** Detect what local CLIs are installed. Cached for the lifetime of the page. */
export async function fetchAgentDetect(force = false): Promise<AgentDetectSnapshot | null> {
  if (!force && detectCache.value) return detectCache.value
  if (detectLoading.value) {
    // Wait for in-flight probe — simple busy-wait loop, fine because the
    // server-side probe is 30s-cached and fast.
    while (detectLoading.value) await new Promise((r) => setTimeout(r, 50))
    return detectCache.value
  }
  detectLoading.value = true
  try {
    const res = await fetch(`${API_BASE}/agent/detect`)
    if (!res.ok) return null
    const snap = (await res.json()) as AgentDetectSnapshot
    detectCache.value = snap
    return snap
  } catch {
    return null
  } finally {
    detectLoading.value = false
  }
}

/** Reactive accessor — Conversation tab binds to this for the empty state. */
export function useAgentDetect() {
  return {
    snapshot: computed(() => detectCache.value),
    loading: computed(() => detectLoading.value),
    refresh: () => fetchAgentDetect(true),
  }
}
