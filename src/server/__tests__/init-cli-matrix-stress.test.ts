/**
 * CLI matrix init suite against the stress-test playground.
 *
 * Runs `createInitRunner` once per local CLI (claude, codex, opencode,
 * copilot) against an isolated copy of `playgrounds/stress-test/`. All four
 * CLIs run concurrently so total wall time ≈ slowest CLI.
 *
 * Each run asserts the three artifacts that init is supposed to produce:
 *   - .annotask/design-spec.json   (parses, ≥3 colors, theme list non-empty)
 *   - .annotask/STYLE_GUIDE.md     (non-template content)
 *   - .annotask/agents.json        (all built-ins filled with provider locked
 *                                   to the requested CLI)
 *
 * Skipped by default. Enable with `ANNOTASK_LIVE_CLI=1`:
 *
 *   ANNOTASK_LIVE_CLI=1 pnpm test:cli-matrix:stress
 *
 * Filter to a subset:
 *
 *   ANNOTASK_LIVE_CLI=1 ANNOTASK_LIVE_ONLY=claude,opencode pnpm test:cli-matrix:stress
 *
 * Keep the per-CLI workspace copies + MDX report for inspection:
 *
 *   ANNOTASK_LIVE_CLI=1 ANNOTASK_CLI_MATRIX_KEEP=1 pnpm test:cli-matrix:stress
 *
 * The MDX report lands at `reports/cli-matrix/<timestamp>/index.mdx`.
 */

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createInitRunner, type InitState } from '../init.js'
import { createAgentDetector, type AgentDetectSnapshot, type AgentDetector } from '../agent-detect.js'
import { BUILT_IN_PERSONAS } from '../../embedded/persona.js'
import {
  LIVE_CLI_ENABLED,
  isLiveCliEnabled,
  liveModelFor,
  type LiveProviderKey,
} from '../../embedded/__tests__/live-cli-helpers.js'
import {
  writeMdxReport,
  type AssertionResult,
  type PerCliRun,
  type RunStatus,
} from './cli-matrix-report.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const STRESS_TEST_ROOT = path.join(REPO_ROOT, 'playgrounds', 'stress-test')

const KEEP_WORKSPACES = process.env.ANNOTASK_CLI_MATRIX_KEEP === '1'
const POLL_INTERVAL_MS = 500
const PER_CLI_TIMEOUT_MS = 12 * 60_000  // init does two CLI spawns; each has its own 5-min cap

const CLI_KEYS: LiveProviderKey[] = [
  'claude-local',
  'codex-local',
  'opencode-local',
  'copilot-local',
]

const describeIf = LIVE_CLI_ENABLED ? describe : describe.skip

interface MatrixContext {
  startedAt: number
  runs: PerCliRun[]
}

describeIf('CLI matrix init — stress-test', () => {
  const context: MatrixContext = { startedAt: Date.now(), runs: [] }
  const createdRoots: string[] = []

  beforeAll(() => {
    context.startedAt = Date.now()
  })

  afterAll(async () => {
    const totalWallMs = Date.now() - context.startedAt
    const timestamp = new Date().toISOString()
    const reportDir = path.join(REPO_ROOT, 'reports', 'cli-matrix', timestamp.replace(/[:.]/g, '-'))
    const reportPath = path.join(reportDir, 'index.mdx')
    try {
      await writeMdxReport(
        {
          timestamp,
          totalWallMs,
          suiteVersion: '1.0',
          runs: context.runs,
          workspaceKept: KEEP_WORKSPACES,
        },
        reportPath,
      )
      console.log(`[cli-matrix] report: ${reportPath}`)
    } catch (err) {
      console.warn(`[cli-matrix] failed to write report: ${(err as Error).message}`)
    }

    if (!KEEP_WORKSPACES) {
      for (const root of createdRoots) {
        await fsp.rm(root, { recursive: true, force: true }).catch(() => {})
      }
    }
  })

  for (const key of CLI_KEYS) {
    it.concurrent(
      `${key} → stress-test`,
      async () => {
        if (!isLiveCliEnabled(key)) {
          const skipped = skipResult(key, liveModelFor(key), `filtered out by ANNOTASK_LIVE_ONLY`)
          context.runs.push(skipped)
          return
        }
        const run = await runOneCli(key, createdRoots)
        context.runs.push(run)
        if (run.status === 'fail') {
          throw new Error(`${key} failed: ${run.reason ?? 'see assertion details'}`)
        }
      },
      PER_CLI_TIMEOUT_MS + 60_000,
    )
  }
})

async function runOneCli(key: LiveProviderKey, createdRoots: string[]): Promise<PerCliRun> {
  const model = liveModelFor(key)
  const detector = createAgentDetector()
  const snap = await detector.detect()
  const status = snap[key]
  if (!status.found) {
    return skipResult(key, model, `${key} CLI not on PATH`)
  }
  if (!status.loggedIn) {
    return skipResult(key, model, `${key} CLI is installed but not logged in`)
  }

  const workspaceRoot = await copyStressWorkspace(key)
  createdRoots.push(workspaceRoot)

  const startedAt = Date.now()
  const agentLines: string[] = []
  const stub = stubDetectorWith(snap, key)
  let lastState: InitState | undefined

  try {
    const runner = createInitRunner({
      projectRoot: workspaceRoot,
      broadcast: (event, data) => {
        if (event === 'init:progress' && data && typeof data === 'object') {
          const lines = (data as { agentLines?: string[] }).agentLines
          if (Array.isArray(lines)) {
            // Replace rather than concat — broadcast carries the cumulative array
            agentLines.length = 0
            agentLines.push(...lines)
          }
        }
      },
      agentDetect: stub,
    })

    runner.start({
      requestedProviderId: key,
      requestedModel: model,
      requestedEffort: 'auto',
    })

    lastState = await waitForCompletion(runner.getState.bind(runner), PER_CLI_TIMEOUT_MS)
  } catch (err) {
    return failResult(key, model, Date.now() - startedAt, agentLines, workspaceRoot,
      `runner threw: ${(err as Error).message}`)
  }

  const elapsedMs = Date.now() - startedAt
  const tokens = lastState?.tokenUsage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
  const tokensExclTurns = {
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    cacheCreationTokens: tokens.cacheCreationTokens,
  }

  const assertions: AssertionResult[] = []
  const designSpec = await readDesignSpec(workspaceRoot)
  const styleGuide = await readStyleGuide(workspaceRoot)
  const agentsJson = await readAgentsJson(workspaceRoot)

  assertions.push({
    name: 'design-spec.json parses',
    ok: designSpec.parsed !== null,
    detail: designSpec.parseError ?? undefined,
  })
  assertions.push({
    name: 'colors ≥ 3',
    ok: designSpec.colorCount >= 3,
    detail: `${designSpec.colorCount} detected`,
  })
  assertions.push({
    name: 'themes non-empty',
    ok: designSpec.themes.length > 0,
    detail: `${designSpec.themes.length} themes`,
  })
  assertions.push({
    name: 'STYLE_GUIDE.md non-template',
    ok: styleGuide.exists && styleGuide.nonTemplate,
    detail: !styleGuide.exists ? 'missing' : (styleGuide.nonTemplate ? `${styleGuide.length} chars` : 'looks identical to template'),
  })
  assertions.push({
    name: 'agents.json — all built-ins filled',
    ok: agentsJson.filledBuiltIns === BUILT_IN_PERSONAS.length,
    detail: `${agentsJson.filledBuiltIns}/${BUILT_IN_PERSONAS.length}`,
  })
  assertions.push({
    name: 'agents.json — providerId locked to requested',
    ok: agentsJson.allProviderId === key,
    detail: agentsJson.allProviderId ?? 'mixed',
  })
  assertions.push({
    name: 'token usage > 0',
    ok: (tokens.inputTokens + tokens.outputTokens) > 0,
    detail: `${tokens.inputTokens} in / ${tokens.outputTokens} out`,
  })

  const failedAssertions = assertions.filter((a) => !a.ok)
  const runStatus: RunStatus = failedAssertions.length === 0 ? 'pass' : 'fail'
  const failReason = failedAssertions.map((a) => a.name + (a.detail ? ` (${a.detail})` : '')).join('; ')

  return {
    key,
    model,
    status: runStatus,
    reason: runStatus === 'fail' ? failReason : undefined,
    elapsedMs,
    tokens: tokensExclTurns,
    assertions,
    designSpec: {
      colorCount: designSpec.colorCount,
      colors: designSpec.colors,
      themes: designSpec.themes,
    },
    styleGuideExcerpt: styleGuide.excerpt,
    agents: agentsJson.summaries,
    agentLinesTail: agentLines.slice(-30),
    workspacePath: workspaceRoot,
  }
}

function skipResult(key: LiveProviderKey, model: string, reason: string): PerCliRun {
  console.warn(`[cli-matrix] ${key} skipped: ${reason}`)
  return {
    key,
    model,
    status: 'skip',
    reason,
    elapsedMs: 0,
    tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    assertions: [],
  }
}

function failResult(
  key: LiveProviderKey,
  model: string,
  elapsedMs: number,
  agentLines: string[],
  workspacePath: string,
  reason: string,
): PerCliRun {
  return {
    key,
    model,
    status: 'fail',
    reason,
    elapsedMs,
    tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    assertions: [{ name: 'runner ran to completion', ok: false, detail: reason }],
    agentLinesTail: agentLines.slice(-30),
    workspacePath,
  }
}

function stubDetectorWith(real: AgentDetectSnapshot, only: LiveProviderKey): AgentDetector {
  const empty: AgentDetectSnapshot = {
    'claude-local': { found: false },
    'codex-local': { found: false },
    'opencode-local': { found: false },
    'copilot-local': { found: false },
    copilot: { found: false },
    openrouter: { hasEnv: false },
    ts: Date.now(),
  }
  const snapshot: AgentDetectSnapshot = { ...empty, [only]: real[only] }
  return {
    detect: async () => snapshot,
    invalidate: () => {},
  }
}

async function copyStressWorkspace(key: LiveProviderKey): Promise<string> {
  const dst = await fsp.mkdtemp(path.join(os.tmpdir(), `annotask-cli-matrix-${key}-`))
  await fsp.cp(STRESS_TEST_ROOT, dst, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(STRESS_TEST_ROOT, src)
      if (rel === '') return true
      const segments = rel.split(path.sep)
      const blocked = new Set(['node_modules', 'dist', '.git', '.turbo', '.annotask', '.next', 'target'])
      return !segments.some((seg) => blocked.has(seg))
    },
  })
  return dst
}

async function waitForCompletion(getState: () => InitState, timeoutMs: number): Promise<InitState> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = getState()
    if (!state.running && state.finishedAt) return state
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`init did not finish within ${Math.round(timeoutMs / 1000)}s`)
}

interface DesignSpecRead {
  parsed: Record<string, unknown> | null
  parseError?: string
  colorCount: number
  colors: Array<{ name?: string; value?: string }>
  themes: Array<{ id?: string; name?: string }>
}

async function readDesignSpec(workspaceRoot: string): Promise<DesignSpecRead> {
  const specPath = path.join(workspaceRoot, '.annotask', 'design-spec.json')
  let raw: string
  try { raw = await fsp.readFile(specPath, 'utf-8') }
  catch (err) { return { parsed: null, parseError: `read failed: ${(err as Error).message}`, colorCount: 0, colors: [], themes: [] } }
  let parsed: any
  try { parsed = JSON.parse(raw) }
  catch (err) { return { parsed: null, parseError: `JSON parse failed: ${(err as Error).message}`, colorCount: 0, colors: [], themes: [] } }
  const colorsRaw = Array.isArray(parsed?.colors) ? parsed.colors : []
  const colors = colorsRaw.slice(0, 5).map((c: any) => ({
    name: typeof c?.name === 'string' ? c.name : (typeof c?.role === 'string' ? c.role : undefined),
    value: typeof c?.value === 'string' ? c.value : (typeof c?.hex === 'string' ? c.hex : undefined),
  }))
  const themesRaw = Array.isArray(parsed?.themes) ? parsed.themes : []
  const themes = themesRaw.map((t: any) => ({
    id: typeof t?.id === 'string' ? t.id : undefined,
    name: typeof t?.name === 'string' ? t.name : undefined,
  }))
  return {
    parsed,
    colorCount: colorsRaw.length,
    colors,
    themes,
  }
}

interface StyleGuideRead {
  exists: boolean
  length: number
  excerpt?: string
  nonTemplate: boolean
}

async function readStyleGuide(workspaceRoot: string): Promise<StyleGuideRead> {
  const guidePath = path.join(workspaceRoot, '.annotask', 'STYLE_GUIDE.md')
  let raw: string
  try { raw = await fsp.readFile(guidePath, 'utf-8') }
  catch { return { exists: false, length: 0, nonTemplate: false } }
  // The template ships with the exact placeholder headings + empty sections.
  // Any CLI that actually filled it in will replace at least one placeholder
  // comment with real content. We check for two signals: length growth AND
  // absence of all four placeholder comments untouched.
  const placeholderCount = (raw.match(/<!--/g) ?? []).length
  const nonTemplate = raw.length > 200 && placeholderCount < 4
  return {
    exists: true,
    length: raw.length,
    excerpt: raw.slice(0, 600),
    nonTemplate,
  }
}

interface AgentsJsonRead {
  filledBuiltIns: number
  allProviderId: string | null
  summaries: Array<{ id: string; firstSentence: string }>
}

async function readAgentsJson(workspaceRoot: string): Promise<AgentsJsonRead> {
  const filePath = path.join(workspaceRoot, '.annotask', 'agents.json')
  let raw: string
  try { raw = await fsp.readFile(filePath, 'utf-8') }
  catch { return { filledBuiltIns: 0, allProviderId: null, summaries: [] } }
  let parsed: any
  try { parsed = JSON.parse(raw) }
  catch { return { filledBuiltIns: 0, allProviderId: null, summaries: [] } }
  const agents = (parsed && typeof parsed === 'object' && parsed.agents) || {}
  let filled = 0
  const providerIds = new Set<string>()
  const summaries: Array<{ id: string; firstSentence: string }> = []
  for (const persona of BUILT_IN_PERSONAS) {
    const entry = agents[persona.id]
    const directions = typeof entry?.projectDirections === 'string' ? entry.projectDirections.trim() : ''
    if (directions.length > 0) filled += 1
    if (typeof entry?.providerId === 'string') providerIds.add(entry.providerId)
    if (directions) {
      const firstSentence = directions.split(/(?<=[.!?])\s+/)[0]?.slice(0, 180) ?? ''
      summaries.push({ id: persona.id, firstSentence })
    } else {
      summaries.push({ id: persona.id, firstSentence: '(empty)' })
    }
  }
  return {
    filledBuiltIns: filled,
    allProviderId: providerIds.size === 1 ? [...providerIds][0] : null,
    summaries,
  }
}
