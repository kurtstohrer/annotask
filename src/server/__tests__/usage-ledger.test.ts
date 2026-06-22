import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createUsageLedger } from '../usage-ledger.js'

describe('UsageLedger', () => {
  let projectRoot: string

  beforeEach(async () => {
    projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'annotask-usage-'))
  })
  afterEach(async () => {
    await fsp.rm(projectRoot, { recursive: true, force: true })
  })

  it('appends entries to .annotask/usage.jsonl', async () => {
    const ledger = createUsageLedger({ projectRoot })
    await ledger.append({
      scope: 'task',
      taskId: 'task-1',
      providerId: 'claude-local',
      inputTokens: 100,
      outputTokens: 50,
    })
    const file = path.join(projectRoot, '.annotask', 'usage.jsonl')
    const raw = await fsp.readFile(file, 'utf-8')
    const lines = raw.split('\n').filter(l => l.trim().length > 0)
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.scope).toBe('task')
    expect(parsed.taskId).toBe('task-1')
    expect(parsed.inputTokens).toBe(100)
    expect(parsed.outputTokens).toBe(50)
    expect(typeof parsed.ts).toBe('number')
  })

  it('skips entries with all-zero token counts', async () => {
    const ledger = createUsageLedger({ projectRoot })
    await ledger.append({ scope: 'task', taskId: 't-1', inputTokens: 0, outputTokens: 0 })
    const file = path.join(projectRoot, '.annotask', 'usage.jsonl')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('clamps negative or NaN values to zero', async () => {
    const ledger = createUsageLedger({ projectRoot })
    await ledger.append({
      scope: 'task',
      inputTokens: -5 as unknown as number,
      outputTokens: Number.NaN as unknown as number,
      cacheReadTokens: 10,
    })
    const entries = await ledger.readAll()
    expect(entries[0].inputTokens).toBe(0)
    expect(entries[0].outputTokens).toBe(0)
    expect(entries[0].cacheReadTokens).toBe(10)
  })

  it('summary() aggregates totals plus per-scope and per-provider breakdowns', async () => {
    const ledger = createUsageLedger({ projectRoot })
    await ledger.append({
      scope: 'init', providerId: 'claude-local', inputTokens: 1000, outputTokens: 200,
    })
    await ledger.append({
      scope: 'task', taskId: 't-1', providerId: 'claude-local', inputTokens: 500, outputTokens: 100,
    })
    await ledger.append({
      scope: 'task', taskId: 't-2', providerId: 'anthropic', inputTokens: 300, outputTokens: 80, cacheReadTokens: 50,
    })
    const summary = await ledger.summary()
    expect(summary.totals.inputTokens).toBe(1800)
    expect(summary.totals.outputTokens).toBe(380)
    expect(summary.totals.cacheReadTokens).toBe(50)
    expect(summary.totals.turns).toBe(3)
    expect(summary.byScope.task.turns).toBe(2)
    expect(summary.byScope.task.inputTokens).toBe(800)
    expect(summary.byScope.init.turns).toBe(1)
    expect(summary.byScope.apply.turns).toBe(0)
    expect(summary.byProvider['claude-local'].turns).toBe(2)
    expect(summary.byProvider['claude-local'].inputTokens).toBe(1500)
    expect(summary.byProvider['anthropic'].turns).toBe(1)
    expect(summary.firstAt).not.toBeNull()
    expect(summary.lastAt).not.toBeNull()
    expect(summary.lastAt!).toBeGreaterThanOrEqual(summary.firstAt!)
  })

  it('returns empty summary when ledger has no entries', async () => {
    const ledger = createUsageLedger({ projectRoot })
    const summary = await ledger.summary()
    expect(summary.totals.turns).toBe(0)
    expect(summary.firstAt).toBeNull()
    expect(summary.lastAt).toBeNull()
  })

  it('recent() returns newest entries first, capped to limit', async () => {
    const ledger = createUsageLedger({ projectRoot })
    for (let i = 1; i <= 5; i++) {
      await ledger.append({ scope: 'task', taskId: `t-${i}`, inputTokens: i * 10, outputTokens: 1 })
    }
    const recent = await ledger.recent(3)
    expect(recent).toHaveLength(3)
    expect(recent[0].taskId).toBe('t-5')
    expect(recent[1].taskId).toBe('t-4')
    expect(recent[2].taskId).toBe('t-3')
  })

  it('tolerates malformed lines from external edits', async () => {
    const ledger = createUsageLedger({ projectRoot })
    await ledger.append({ scope: 'task', inputTokens: 1, outputTokens: 1 })
    const file = path.join(projectRoot, '.annotask', 'usage.jsonl')
    await fsp.appendFile(file, 'this is not json\n', 'utf-8')
    await ledger.append({ scope: 'task', inputTokens: 2, outputTokens: 2 })
    const all = await ledger.readAll()
    expect(all).toHaveLength(2)
    expect(all[0].inputTokens).toBe(1)
    expect(all[1].inputTokens).toBe(2)
  })
})
