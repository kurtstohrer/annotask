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
})
