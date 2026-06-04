/**
 * Per-task conversation thread store.
 *
 * Each task gets an append-only JSONL log at `.annotask/conversations/<taskId>.jsonl`.
 * One line per message: `{ id, ts, role, content, providerId?, model?, usage?, toolCalls? }`.
 *
 * Why JSONL on disk rather than an in-memory ring or sqlite:
 *   - The same file is read by external agents through the MCP
 *     `annotask_conversation_*` tools, so persistence is a feature not an
 *     accident. Users can run `tail -f` on a conversation while it streams.
 *   - Append-only means no consistency questions across browser tab,
 *     external CLI, and MCP simultaneously.
 *   - Replay from disk on reconnect is trivial — we don't need a stream
 *     backplane beyond "stat the file."
 *
 * Live updates: each task has a `Set<Listener>` of in-process subscribers
 * (browser SSE clients, MCP long-polls). Append fans out synchronously.
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { WorkStreamBlock } from '../shared/work-stream.js'

const SAFE_TASK_ID = /^task-[A-Za-z0-9_-]+$/
const MAX_CONTENT_BYTES = 1_000_000 // 1 MB per message — chat replies don't reasonably exceed this

export type ThreadRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ThreadMessage {
  id: string
  ts: number
  role: ThreadRole
  content: string
  /** Provider id the assistant turn ran against. Undefined for user/system. */
  providerId?: string
  /** Model id reported by the provider. */
  model?: string
  /** Optional usage counters (mirrors ProviderEvent shape). */
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
  }
  /**
   * For assistant turns that called tools. Stored alongside content so a
   * future tool-bridge pass can reconstruct the turn without inferring
   * structure from prose.
   */
  toolCalls?: Array<{ id: string; name: string; input: unknown }>
  /** For tool-role messages: which tool_use this is a result for. */
  toolUseId?: string
  /**
   * Ordered work-stream blocks for the turn — text deltas interleaved with
   * tool_call / tool_result blocks. The Conversation tab renders these as
   * the rich timeline; `content` stays for MCP/CLI tail-readers as a flat
   * text rollup. Optional so legacy turns (pre work-stream) still parse.
   */
  blocks?: WorkStreamBlock[]
  /**
   * True while an assistant turn is still streaming. The embedded agent
   * appends one assistant message with `isPartial: true` at the start of a
   * turn, then `update()`s it in place as events arrive (throttled), clearing
   * the flag on the final flush. Lets *any* subscriber (a Conversation tab
   * that attached mid-run, an MCP tail-reader) observe progress instead of
   * waiting for the whole turn to land at once.
   */
  isPartial?: boolean
  /**
   * Wall-clock of the last streamed event for a partial turn. The stall
   * watchdog / "stalled?" UI compares it to `now` to detect a run that
   * stopped producing output.
   */
  lastEventAt?: number
}

export interface TaskThreadOptions {
  projectRoot: string
  /**
   * Fires after a message is appended to disk. Used to feed token-usage
   * rollups: when `msg.usage` is set, the server wires this to update the
   * task's `tokenUsage` field and write a ledger entry. Optional so tests
   * and CLI usage of the store don't need to wire anything.
   */
  onAppend?: (taskId: string, msg: ThreadMessage) => void
}

export interface AppendInput {
  role: ThreadRole
  content: string
  providerId?: string
  model?: string
  usage?: ThreadMessage['usage']
  toolCalls?: ThreadMessage['toolCalls']
  toolUseId?: string
  blocks?: WorkStreamBlock[]
  isPartial?: boolean
  lastEventAt?: number
}

/** Mutable fields an `update()` may patch on an existing message. */
export type UpdateInput = Partial<
  Pick<ThreadMessage, 'content' | 'blocks' | 'usage' | 'isPartial' | 'lastEventAt' | 'model' | 'providerId'>
>

type Listener = (msg: ThreadMessage) => void

export interface TaskThreadStore {
  /** Read the full thread snapshot, optionally filtered to messages after `afterId`. */
  read(taskId: string, opts?: { afterId?: string }): Promise<ThreadMessage[]>
  /** Append a message; returns the stored record (with id+ts assigned). */
  append(taskId: string, input: AppendInput): Promise<ThreadMessage>
  /**
   * Patch an existing message in place (by id). Used to stream a partial
   * assistant turn: append once, then update the same line as events arrive.
   * Returns the merged record, or `null` if no message with that id exists.
   */
  update(taskId: string, id: string, patch: UpdateInput): Promise<ThreadMessage | null>
  /** Subscribe to live appends. Returns an unsubscribe fn. */
  subscribe(taskId: string, listener: Listener): () => void
  /** Drop the on-disk log for a task — called when the task is deleted. */
  clear(taskId: string): Promise<void>
}

export function createTaskThreadStore(opts: TaskThreadOptions): TaskThreadStore {
  const dir = path.join(opts.projectRoot, '.annotask', 'conversations')
  const listeners = new Map<string, Set<Listener>>()
  // Serialize writes per task so two simultaneous append() calls can't
  // interleave their JSONL lines.
  const writeLocks = new Map<string, Promise<unknown>>()

  function safePath(taskId: string): string | null {
    if (!SAFE_TASK_ID.test(taskId)) return null
    return path.join(dir, `${taskId}.jsonl`)
  }

  async function appendInternal(taskId: string, msg: ThreadMessage): Promise<void> {
    const p = safePath(taskId)
    if (!p) throw new Error(`Invalid taskId: ${taskId}`)
    await fsp.mkdir(dir, { recursive: true })
    const line = JSON.stringify(msg) + '\n'
    await fsp.appendFile(p, line, 'utf-8')
  }

  async function read(
    taskId: string,
    o: { afterId?: string } = {},
  ): Promise<ThreadMessage[]> {
    const p = safePath(taskId)
    if (!p) return []
    let raw: string
    try { raw = await fsp.readFile(p, 'utf-8') }
    catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    const msgs: ThreadMessage[] = []
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try {
        const parsed = JSON.parse(t) as ThreadMessage
        msgs.push(parsed)
      } catch {
        // Skip malformed lines silently — better to serve a partial thread
        // than to 500 because one byte got corrupted.
      }
    }
    if (o.afterId) {
      const idx = msgs.findIndex((m) => m.id === o.afterId)
      if (idx >= 0) return msgs.slice(idx + 1)
    }
    return msgs
  }

  async function append(taskId: string, input: AppendInput): Promise<ThreadMessage> {
    if (input.content.length > MAX_CONTENT_BYTES) {
      throw new Error(`message content exceeds ${MAX_CONTENT_BYTES} bytes`)
    }
    const msg: ThreadMessage = {
      id: `msg-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      ts: Date.now(),
      role: input.role,
      content: input.content,
      providerId: input.providerId,
      model: input.model,
      usage: input.usage,
      toolCalls: input.toolCalls,
      toolUseId: input.toolUseId,
      blocks: input.blocks,
      isPartial: input.isPartial,
      lastEventAt: input.lastEventAt,
    }
    const prev = writeLocks.get(taskId) ?? Promise.resolve()
    const next = prev
      .catch(() => undefined)
      .then(() => appendInternal(taskId, msg))
    writeLocks.set(taskId, next)
    await next
    fanOut(taskId, msg)
    return msg
  }

  /**
   * Rewrite the whole JSONL file with `lines` via a temp file + atomic
   * rename, so a reader never sees a half-written log. Runs inside the
   * per-task write lock (callers chain it through `writeLocks`).
   */
  async function rewriteInternal(taskId: string, lines: ThreadMessage[]): Promise<void> {
    const p = safePath(taskId)
    if (!p) throw new Error(`Invalid taskId: ${taskId}`)
    await fsp.mkdir(dir, { recursive: true })
    const body = lines.map((m) => JSON.stringify(m)).join('\n') + (lines.length > 0 ? '\n' : '')
    const tmp = `${p}.${crypto.randomBytes(4).toString('hex')}.tmp`
    await fsp.writeFile(tmp, body, 'utf-8')
    await fsp.rename(tmp, p)
  }

  /** Fan a (new or updated) message out to subscribers + the onAppend sink. */
  function fanOut(taskId: string, msg: ThreadMessage): void {
    const set = listeners.get(taskId)
    if (set) {
      for (const fn of set) {
        try { fn(msg) } catch { /* one bad listener mustn't block others */ }
      }
    }
    if (opts.onAppend) {
      try { opts.onAppend(taskId, msg) } catch { /* never block the response on a downstream sink */ }
    }
  }

  async function update(taskId: string, id: string, patch: UpdateInput): Promise<ThreadMessage | null> {
    if (typeof patch.content === 'string' && patch.content.length > MAX_CONTENT_BYTES) {
      throw new Error(`message content exceeds ${MAX_CONTENT_BYTES} bytes`)
    }
    // Serialize against append/update on the same task. The lock value is a
    // promise resolving to the merged message (or null when the id is gone)
    // so the awaited result below reflects this update specifically.
    const prev = writeLocks.get(taskId) ?? Promise.resolve()
    const next = prev
      .catch(() => undefined)
      .then(async (): Promise<ThreadMessage | null> => {
        const all = await read(taskId)
        const idx = all.findIndex((m) => m.id === id)
        if (idx < 0) return null
        const merged: ThreadMessage = { ...all[idx], ...patch }
        all[idx] = merged
        await rewriteInternal(taskId, all)
        return merged
      })
    writeLocks.set(taskId, next)
    const merged = await next
    if (merged) fanOut(taskId, merged)
    return merged
  }

  function subscribe(taskId: string, listener: Listener): () => void {
    let set = listeners.get(taskId)
    if (!set) { set = new Set(); listeners.set(taskId, set) }
    set.add(listener)
    return () => {
      const s = listeners.get(taskId)
      if (!s) return
      s.delete(listener)
      if (s.size === 0) listeners.delete(taskId)
    }
  }

  async function clear(taskId: string): Promise<void> {
    const p = safePath(taskId)
    if (!p) return
    try { await fsp.unlink(p) } catch { /* already gone */ }
  }

  return { read, append, update, subscribe, clear }
}

/** Async wait used by SSE handlers when there's nothing new to send. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) }, { once: true })
  })
}

/** Filesystem helpers exposed for tests. */
export const __test = { SAFE_TASK_ID }
// Suppress unused-import warning for `fs` since we may reference it in tests later.
void fs
