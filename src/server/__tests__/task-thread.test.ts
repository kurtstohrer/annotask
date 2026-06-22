import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createTaskThreadStore } from '../task-thread.js'

describe('TaskThreadStore', () => {
  let projectRoot: string

  beforeEach(async () => {
    projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'annotask-thread-'))
  })
  afterEach(async () => {
    await fsp.rm(projectRoot, { recursive: true, force: true })
  })

  it('appends and reads messages in order', async () => {
    const store = createTaskThreadStore({ projectRoot })
    await store.append('task-1', { role: 'user', content: 'hello' })
    await store.append('task-1', { role: 'assistant', content: 'world', providerId: 'anthropic' })
    const msgs = await store.read('task-1')
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].content).toBe('hello')
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[1].providerId).toBe('anthropic')
  })

  it('rejects unsafe task ids', async () => {
    const store = createTaskThreadStore({ projectRoot })
    await expect(store.append('../escape', { role: 'user', content: 'x' })).rejects.toThrow()
  })

  it('returns [] for an unknown task', async () => {
    const store = createTaskThreadStore({ projectRoot })
    const msgs = await store.read('task-unknown-id')
    expect(msgs).toEqual([])
  })

  it('respects afterId filter', async () => {
    const store = createTaskThreadStore({ projectRoot })
    const a = await store.append('task-2', { role: 'user', content: 'one' })
    await store.append('task-2', { role: 'assistant', content: 'two' })
    await store.append('task-2', { role: 'user', content: 'three' })
    const rest = await store.read('task-2', { afterId: a.id })
    expect(rest.map((m) => m.content)).toEqual(['two', 'three'])
  })

  it('fires onAppend after each write (used for ledger + per-task usage rollup)', async () => {
    const seen: Array<{ taskId: string; usage: unknown }> = []
    const store = createTaskThreadStore({
      projectRoot,
      onAppend: (taskId, msg) => { seen.push({ taskId, usage: msg.usage }) },
    })
    await store.append('task-hook', { role: 'user', content: 'hi' })
    await store.append('task-hook', {
      role: 'assistant',
      content: 'hello',
      usage: { inputTokens: 12, outputTokens: 3 },
    })
    expect(seen).toHaveLength(2)
    expect(seen[0].usage).toBeUndefined()
    expect(seen[1].usage).toEqual({ inputTokens: 12, outputTokens: 3 })
  })

  it('fans out to subscribers after the write lands', async () => {
    const store = createTaskThreadStore({ projectRoot })
    const seen: string[] = []
    const unsubscribe = store.subscribe('task-3', (m) => { seen.push(m.content) })
    await store.append('task-3', { role: 'user', content: 'live' })
    expect(seen).toEqual(['live'])
    unsubscribe()
    await store.append('task-3', { role: 'user', content: 'after-unsub' })
    expect(seen).toEqual(['live']) // unsubscribed
  })

  it('persists across store instances (real JSONL file)', async () => {
    const a = createTaskThreadStore({ projectRoot })
    await a.append('task-4', { role: 'user', content: 'persistent' })
    const b = createTaskThreadStore({ projectRoot })
    const msgs = await b.read('task-4')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('persistent')
  })

  it('updates a message in place by id (streaming a partial turn)', async () => {
    const store = createTaskThreadStore({ projectRoot })
    await store.append('task-up', { role: 'user', content: 'go' })
    const partial = await store.append('task-up', { role: 'assistant', content: '', isPartial: true })

    const mid = await store.update('task-up', partial.id, {
      content: 'work...',
      blocks: [{ kind: 'text', text: 'work...' }],
      lastEventAt: 123,
    })
    expect(mid?.content).toBe('work...')
    expect(mid?.isPartial).toBe(true) // not cleared yet
    expect(mid?.lastEventAt).toBe(123)

    const final = await store.update('task-up', partial.id, { content: 'done', isPartial: false })
    expect(final?.isPartial).toBe(false)

    // Still exactly two lines — the partial line was rewritten, not appended.
    const msgs = await store.read('task-up')
    expect(msgs).toHaveLength(2)
    expect(msgs[1].id).toBe(partial.id)
    expect(msgs[1].content).toBe('done')
    expect(msgs[1].blocks).toEqual([{ kind: 'text', text: 'work...' }])
  })

  it('update returns null for an unknown message id', async () => {
    const store = createTaskThreadStore({ projectRoot })
    await store.append('task-up2', { role: 'user', content: 'x' })
    const res = await store.update('task-up2', 'msg-does-not-exist', { content: 'nope' })
    expect(res).toBeNull()
  })

  it('fans out updates to subscribers (so observers stream a partial turn)', async () => {
    const store = createTaskThreadStore({ projectRoot })
    const seen: Array<{ content: string; isPartial?: boolean }> = []
    store.subscribe('task-up3', (m) => { seen.push({ content: m.content, isPartial: m.isPartial }) })
    const partial = await store.append('task-up3', { role: 'assistant', content: '', isPartial: true })
    await store.update('task-up3', partial.id, { content: 'a' })
    await store.update('task-up3', partial.id, { content: 'ab', isPartial: false })
    expect(seen).toEqual([
      { content: '', isPartial: true },
      { content: 'a', isPartial: true },
      { content: 'ab', isPartial: false },
    ])
  })

  it('serializes interleaved append + update under the write lock', async () => {
    const store = createTaskThreadStore({ projectRoot })
    const partial = await store.append('task-up4', { role: 'assistant', content: '', isPartial: true })
    // Fire an update and a fresh append without awaiting between them.
    await Promise.all([
      store.update('task-up4', partial.id, { content: 'streamed', isPartial: false }),
      store.append('task-up4', { role: 'user', content: 'interrupt' }),
    ])
    const msgs = await store.read('task-up4')
    expect(msgs).toHaveLength(2)
    expect(msgs.find((m) => m.id === partial.id)?.content).toBe('streamed')
    expect(msgs.some((m) => m.content === 'interrupt')).toBe(true)
  })

  it('tail-rewrites the streaming partial: many updates stay consistent on disk', async () => {
    const store = createTaskThreadStore({ projectRoot })
    await store.append('task-stream', { role: 'user', content: 'task' })
    const partial = await store.append('task-stream', { role: 'assistant', content: '', isPartial: true })
    // Simulate a streaming turn: many in-place updates to the last (partial) line.
    for (let i = 1; i <= 25; i++) {
      await store.update('task-stream', partial.id, { content: 'x'.repeat(i), isPartial: i < 25 })
    }
    // A FRESH store reads from disk only — proves the tail-rewrites left a valid
    // JSONL file (exactly two lines, last one fully updated), not a corrupted tail.
    const fresh = createTaskThreadStore({ projectRoot })
    const msgs = await fresh.read('task-stream')
    expect(msgs).toHaveLength(2)
    expect(msgs[0].content).toBe('task')
    expect(msgs[1].id).toBe(partial.id)
    expect(msgs[1].content).toBe('x'.repeat(25))
    expect(msgs[1].isPartial).toBe(false)
  })

  it('updates an earlier (non-last) message via the full-rewrite fallback', async () => {
    const store = createTaskThreadStore({ projectRoot })
    const first = await store.append('task-mid', { role: 'user', content: 'first' })
    await store.append('task-mid', { role: 'assistant', content: 'second' })
    await store.append('task-mid', { role: 'user', content: 'third' })
    const updated = await store.update('task-mid', first.id, { content: 'FIRST-EDITED' })
    expect(updated?.content).toBe('FIRST-EDITED')
    const fresh = createTaskThreadStore({ projectRoot })
    const msgs = await fresh.read('task-mid')
    expect(msgs.map((m) => m.content)).toEqual(['FIRST-EDITED', 'second', 'third'])
    expect(msgs).toHaveLength(3)
  })
})
