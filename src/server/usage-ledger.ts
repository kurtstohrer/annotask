/**
 * Project-wide token usage ledger.
 *
 * One append-only JSONL file at `.annotask/usage.jsonl`. Every provider turn
 * (chat against a task, init agent run, ad-hoc apply) lands as one line:
 *
 *   { ts, scope, taskId?, runId?, providerId?, model?, label?,
 *     inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }
 *
 * Append-only mirrors the conversation log on disk so external tooling can
 * `tail -f` the spend, and there's no consistency dance between the shell,
 * the CLI, and MCP — they all read the same file. Summarization is computed
 * on demand by scanning the file; the ledger is small enough that this stays
 * fast for the lifetime of a typical project.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'

export type UsageScope = 'task' | 'init' | 'apply' | 'chat'

export interface UsageEntry {
  ts: number
  scope: UsageScope
  /** Set when the entry belongs to a specific task (chat / apply turn). */
  taskId?: string
  /** Set for init runs and other non-task agent invocations. */
  runId?: string
  /** Provider id reported by the embedded chat (e.g. `claude-local`). */
  providerId?: string
  /** Model id reported by the provider. */
  model?: string
  /** Free-form label for UI display (e.g. `'annotask-init'`). */
  label?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  /** Counts derived from character length because the CLI reported no (or
   *  output-only) usage — closer to truth than 0, but not authoritative. */
  estimated?: boolean
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** Number of ledger entries folded in. */
  turns: number
  /** How many of those entries carried character-length estimates instead of
   *  provider-reported counts (CLIs that report no/partial usage). */
  estimatedTurns: number
}

export interface UsageSummary {
  totals: UsageTotals
  byScope: Record<UsageScope, UsageTotals>
  byProvider: Record<string, UsageTotals>
  /** Epoch ms of the oldest entry, or null when the ledger is empty. */
  firstAt: number | null
  /** Epoch ms of the newest entry, or null when the ledger is empty. */
  lastAt: number | null
}

export interface UsageLedgerOptions {
  projectRoot: string
}

export interface UsageLedger {
  /** Append one entry. Resolves once the line is flushed to disk. */
  append(entry: Omit<UsageEntry, 'ts'> & { ts?: number }): Promise<UsageEntry>
  /** Read every entry from disk. Used by summary() and tests. */
  readAll(): Promise<UsageEntry[]>
  /** Compute aggregate totals + per-scope + per-provider tallies. */
  summary(): Promise<UsageSummary>
  /** Most recent N entries (newest first). */
  recent(limit?: number): Promise<UsageEntry[]>
}

function emptyTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    turns: 0,
    estimatedTurns: 0,
  }
}

function addInto(target: UsageTotals, e: UsageEntry): void {
  target.inputTokens += clamp(e.inputTokens)
  target.outputTokens += clamp(e.outputTokens)
  target.cacheReadTokens += clamp(e.cacheReadTokens)
  target.cacheCreationTokens += clamp(e.cacheCreationTokens)
  target.turns += 1
  if (e.estimated === true) target.estimatedTurns += 1
}

function clamp(n: number | undefined): number {
  if (n == null || !Number.isFinite(n) || n < 0) return 0
  return n
}

export function createUsageLedger(opts: UsageLedgerOptions): UsageLedger {
  const filePath = path.join(opts.projectRoot, '.annotask', 'usage.jsonl')
  // Serialize writes so two callers can't interleave their JSONL lines.
  let writeChain: Promise<unknown> = Promise.resolve()

  async function appendLine(line: string): Promise<void> {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    await fsp.appendFile(filePath, line, 'utf-8')
  }

  async function append(input: Omit<UsageEntry, 'ts'> & { ts?: number }): Promise<UsageEntry> {
    const entry: UsageEntry = {
      ts: input.ts ?? Date.now(),
      scope: input.scope,
      taskId: input.taskId,
      runId: input.runId,
      providerId: input.providerId,
      model: input.model,
      label: input.label,
      inputTokens: clamp(input.inputTokens),
      outputTokens: clamp(input.outputTokens),
      cacheReadTokens: clamp(input.cacheReadTokens),
      cacheCreationTokens: clamp(input.cacheCreationTokens),
      ...(input.estimated === true ? { estimated: true } : {}),
    }
    // Skip purely-empty turns — they add noise without adding signal.
    if (
      entry.inputTokens === 0 &&
      entry.outputTokens === 0 &&
      entry.cacheReadTokens === 0 &&
      entry.cacheCreationTokens === 0
    ) {
      return entry
    }
    const line = JSON.stringify(entry) + '\n'
    const run = writeChain.then(() => appendLine(line))
    writeChain = run.catch(() => { /* isolate: next op should still run */ })
    await run
    return entry
  }

  async function readAll(): Promise<UsageEntry[]> {
    let raw: string
    try { raw = await fsp.readFile(filePath, 'utf-8') }
    catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    const out: UsageEntry[] = []
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try {
        const parsed = JSON.parse(t) as UsageEntry
        if (parsed && typeof parsed.ts === 'number' && typeof parsed.scope === 'string') {
          out.push(parsed)
        }
      } catch {
        // Skip malformed lines silently — better to serve a partial summary
        // than to 500 because one byte got corrupted.
      }
    }
    return out
  }

  async function summary(): Promise<UsageSummary> {
    const entries = await readAll()
    const totals = emptyTotals()
    const byScope: Record<UsageScope, UsageTotals> = {
      task: emptyTotals(),
      init: emptyTotals(),
      apply: emptyTotals(),
      chat: emptyTotals(),
    }
    const byProvider: Record<string, UsageTotals> = {}
    let firstAt: number | null = null
    let lastAt: number | null = null
    for (const e of entries) {
      addInto(totals, e)
      addInto(byScope[e.scope] ?? (byScope[e.scope] = emptyTotals()), e)
      const key = e.providerId ?? 'unknown'
      addInto(byProvider[key] ?? (byProvider[key] = emptyTotals()), e)
      if (firstAt === null || e.ts < firstAt) firstAt = e.ts
      if (lastAt === null || e.ts > lastAt) lastAt = e.ts
    }
    return { totals, byScope, byProvider, firstAt, lastAt }
  }

  async function recent(limit = 50): Promise<UsageEntry[]> {
    const entries = await readAll()
    return entries.slice(-Math.max(0, limit)).reverse()
  }

  return { append, readAll, summary, recent }
}
