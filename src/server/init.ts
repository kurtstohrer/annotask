/**
 * Server-side init pipeline.
 *
 * Two-phase flow:
 *   1. `start()` — runs scan steps, assembles a `draft` in memory.
 *      Nothing is written to disk; the wizard moves to Review.
 *   2. `commit(edits)` — writes design-spec.json + STYLE_GUIDE.md.
 *
 * How token extraction works:
 *   If a local CLI (claude, codex, opencode) is installed and logged in, the
 *   pipeline spawns it with the `annotask-init` skill as its system prompt.
 *   The agent reads CSS files, Tailwind config, theme selectors, etc. and
 *   writes `.annotask/design-spec.json` using its native file-edit tools —
 *   exactly as if the user had run `/annotask-init` in Claude Code.
 *
 *   The pipeline watches for the file to land on disk (same watcher used by
 *   state.ts for hot-reload) and reads it as the draft.
 *
 *   If no local CLI is available, the pipeline falls back to a lightweight
 *   server-side scanner that extracts CSS custom properties and framework
 *   info without LLM assistance.
 */

import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { scanComponentLibraries } from './component-scanner.js'
import { scanDataSources } from './data-source-scanner.js'
import { scanApiSchemas } from './api-schema-scanner.js'
import type { AgentDetector } from './agent-detect.js'
import type { UsageLedger } from './usage-ledger.js'
import { loadSkill } from '../skills/index.js'
import { BUILT_IN_PERSONAS } from '../embedded/persona.js'
import type { ProviderId, EffortLevel } from '../embedded/provider-config.js'
import { EFFORTS_BY_PROVIDER, EFFORT_LEVELS } from '../embedded/provider-config.js'
import type { AgentConfigEntry } from './agent-configs.js'

/** Per-persona "what to investigate in the codebase" hint. The init CLI uses
 *  these to know what kind of project context belongs in each agent's blob. */
const PERSONA_GROUND_HINTS: Record<string, string> = {
  general:    'What this app does + naming conventions + copy/tone guidelines + the framework/build system in use.',
  designer:   'CSS approach (Tailwind/CSS variables/SCSS/etc), the component library if any, spacing scale + color tokens + typography patterns the project actually follows.',
  a11y:       'Existing a11y patterns or libraries already in use (axe, eslint-plugin-jsx-a11y, focus-trap, etc.), target WCAG level, semantic HTML conventions in this codebase.',
  'bug-hunter': 'Test setup (vitest/jest/playwright), error tracking libraries, logging conventions, how the project boots/builds so debugging hits root cause rather than symptoms.',
}

export type InitStepStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped'

export interface InitStep {
  id: string
  label: string
  status: InitStepStatus
  message?: string
  startedAt?: number
  finishedAt?: number
}

export interface InitDraft {
  spec: Record<string, unknown>
  styleGuide: string
  styleGuideExists: boolean
  designSpecExists: boolean
}

export interface InitState {
  running: boolean
  startedAt?: number
  finishedAt?: number
  result?: 'success' | 'error' | 'cancelled' | 'awaiting_review'
  error?: string
  steps: InitStep[]
  draft?: InitDraft
  committedAt?: number
  /** Lines streamed from the local CLI agent during init. */
  agentLines?: string[]
  /** Which CLI the agent step used, for display. */
  agentCli?: string
  /**
   * Running token usage tally for this init run. Accumulated across every
   * agent CLI invocation (design-spec + agent-configs) so the wizard can
   * surface a live counter. Reset on each `start()`.
   */
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    turns: number
  }
}

export interface InitCommitBody {
  spec?: Record<string, unknown>
  styleGuide?: string
  overwriteStyleGuide?: boolean
}

export interface ScanOptions {
  /** Skip the LLM-driven design-spec / style-guide pass (framework + themes
   *  + agent-scan + commit). Used by re-scan mode when the user only wants
   *  to refresh agents.json or recompute components/data-sources/api-schemas
   *  without rewriting the design-spec via the LLM. */
  skipAgentScan?: boolean
  /** Skip the separate agent-directions CLI invocation. */
  skipAgentConfigs?: boolean
  /** Skip the component library scan. */
  skipComponents?: boolean
  /** Skip the data-source scan. */
  skipDataSources?: boolean
  /** Skip the API schema scan. */
  skipApiSchemas?: boolean
  /** Provider selected in the init-agent step. Local CLIs use this exactly
   *  when available so downstream agent defaults match the init agent. */
  requestedProviderId?: ProviderId
  /** Model selected for the init-agent provider. Passed to local CLIs that
   *  support an explicit model flag (Claude, Codex, OpenCode). */
  requestedModel?: string
  requestedEffort?: EffortLevel
}

export interface InitRunner {
  start: (opts?: ScanOptions) => InitState
  cancel: () => void
  commit: (body: InitCommitBody) => Promise<InitState>
  /**
   * Mark the project as initialized without committing any token data. Used
   * when the user chooses to run the annotask-init skill in their editor
   * agent instead of going through the wizard. Writes a minimal accepted
   * spec so the wizard closes and the "not initialized" banner disappears.
   */
  skip: () => Promise<InitState>
  getState: () => InitState
}

interface Deps {
  projectRoot: string
  broadcast: (event: string, data: unknown) => void
  agentDetect: AgentDetector
  /** Optional — when provided, each init agent run logs its token totals here. */
  usageLedger?: UsageLedger
}

const SCAN_STEPS: Array<{ id: string; label: string }> = [
  { id: 'framework',     label: 'Detect framework and styling' },
  { id: 'themes',        label: 'Detect theme variants' },
  { id: 'agent-scan',    label: 'Extract design tokens with your agent' },
  { id: 'agent-configs', label: 'Write agent directions' },
  { id: 'components',    label: 'Scan component library' },
  { id: 'data-sources',  label: 'Scan data sources' },
  { id: 'api-schemas',   label: 'Scan API schemas' },
]

type InitLocalProviderId = Extract<ProviderId, 'claude-local' | 'codex-local' | 'opencode-local' | 'copilot-local'>

interface InitCliOption {
  id: InitLocalProviderId
  bin: 'claude' | 'codex' | 'opencode' | 'copilot'
  label: string
}

const INIT_CLI_OPTIONS: readonly InitCliOption[] = [
  { id: 'claude-local',   bin: 'claude',   label: 'Claude' },
  { id: 'codex-local',    bin: 'codex',    label: 'Codex' },
  { id: 'opencode-local', bin: 'opencode', label: 'OpenCode' },
  { id: 'copilot-local',  bin: 'copilot',  label: 'Copilot' },
]

function isInitLocalProviderId(id: ProviderId | undefined): id is InitLocalProviderId {
  return id === 'claude-local' || id === 'codex-local' ||
    id === 'opencode-local' || id === 'copilot-local'
}

function isFoundLocalCli(snap: Awaited<ReturnType<AgentDetector['detect']>>, id: InitLocalProviderId): boolean {
  const status = snap[id]
  return !!status?.found
}

function isReadyLocalCli(snap: Awaited<ReturnType<AgentDetector['detect']>>, id: InitLocalProviderId): boolean {
  const status = snap[id]
  return !!(status?.found && status?.loggedIn)
}

function selectInitCli(
  snap: Awaited<ReturnType<AgentDetector['detect']>>,
  requestedProviderId?: ProviderId,
): InitCliOption | null {
  if (isInitLocalProviderId(requestedProviderId)) {
    if (!isFoundLocalCli(snap, requestedProviderId)) return null
    return INIT_CLI_OPTIONS.find(c => c.id === requestedProviderId) ?? null
  }
  return INIT_CLI_OPTIONS.find(c => isReadyLocalCli(snap, c.id)) ?? null
}

/**
 * Decide what model/effort to forward to the init CLI.
 *
 * The shell sends `requestedModel` + `requestedEffort` straight from the
 * user's active provider config. Those identifiers are namespaced by
 * provider — Copilot's `gpt-5.4-mini`, OpenRouter's `anthropic/...`, etc.
 * If init had to substitute a different CLI than the user requested
 * (e.g. user picked `copilot` but only `claude` is installed locally),
 * forwarding the model is guaranteed to fail: the substituted CLI will
 * reject the id with a "model may not exist" error. Drop the model and
 * effort in that case so the substituted CLI uses its own default; the
 * caller logs a note explaining the substitution.
 */
function narrowRuntimeToCli(
  available: InitCliOption,
  opts: { requestedProviderId?: ProviderId; requestedModel?: string; requestedEffort?: EffortLevel },
): { model: string | undefined; effort: EffortLevel | undefined; substituted: boolean } {
  const matches = opts.requestedProviderId === available.id
  if (matches) return { model: opts.requestedModel, effort: opts.requestedEffort, substituted: false }
  return { model: undefined, effort: undefined, substituted: opts.requestedProviderId != null }
}

/**
 * Rewrite `.annotask/agents.json` so every built-in persona uses the exact
 * provider/model/effort the user selected in the Init Wizard. Custom personas
 * (ids that aren't built-ins) are preserved untouched.
 *
 * Called twice during init:
 *   1. Before the CLI runs — seeds the file so the CLI sees the target shape.
 *      `fallbackRoleText: false` keeps `projectDirections` empty so the CLI is
 *      forced to write fresh content (otherwise it tends to keep the built-in
 *      role text verbatim).
 *   2. After the CLI runs — re-opens the file and forcibly restores the
 *      selected provider/model/effort in case the CLI rewrote them.
 *      `fallbackRoleText: true` so any persona the CLI left blank ends up with
 *      at least its built-in role identity.
 *
 * The selected `providerId`/`model`/`effort` always wins. Prior values for
 * built-in personas are never preserved — re-init with a different provider
 * must overwrite previous Claude defaults.
 */
async function enforceSelectedRuntime(opts: {
  filePath: string
  providerId: ProviderId
  model: string
  effort: EffortLevel
  fallbackRoleText: boolean
}): Promise<{ backfilled: number; filled: number; totalBuiltIns: number }> {
  let existing: Record<string, any> = {}
  try {
    const raw = JSON.parse(await fsp.readFile(opts.filePath, 'utf-8'))
    if (raw && typeof raw.agents === 'object' && raw.agents !== null) existing = raw.agents
  } catch { /* missing or unreadable — treat as empty */ }

  const agents: Record<string, AgentConfigEntry> = {}
  let backfilled = 0
  for (const persona of BUILT_IN_PERSONAS) {
    const prior = existing[persona.id] ?? {}
    const priorDirections = typeof prior.projectDirections === 'string' ? prior.projectDirections : ''
    const hasDirections = priorDirections.trim().length > 0
    let directions: string
    if (hasDirections) {
      directions = priorDirections
    } else if (opts.fallbackRoleText) {
      directions = persona.roleDirections
      backfilled += 1
    } else {
      directions = ''
    }
    agents[persona.id] = {
      projectDirections: directions,
      providerId: opts.providerId,
      model: opts.model,
      effort: opts.effort,
    }
  }
  for (const [id, value] of Object.entries(existing)) {
    if (agents[id]) continue
    const v = value as Partial<AgentConfigEntry>
    agents[id] = {
      projectDirections: typeof v?.projectDirections === 'string' ? v.projectDirections : '',
      ...(v?.providerId ? { providerId: v.providerId } : {}),
      ...(typeof v?.model === 'string' ? { model: v.model } : {}),
      ...(v?.effort ? { effort: v.effort } : {}),
    }
  }

  await fsp.mkdir(path.dirname(opts.filePath), { recursive: true })
  const tmp = `${opts.filePath}.tmp.${process.pid}.${Date.now()}`
  await fsp.writeFile(tmp, JSON.stringify({ version: 1, agents }, null, 2), 'utf-8')
  await fsp.rename(tmp, opts.filePath)

  const filled = Object.values(agents).filter(
    (a) => typeof a?.projectDirections === 'string' && a.projectDirections.trim(),
  ).length
  return { backfilled, filled, totalBuiltIns: BUILT_IN_PERSONAS.length }
}

/**
 * Build the prompt sent to the init CLI to fill `projectDirections`. Exported
 * for tests so we can assert the CLI is never asked to pick a model/effort per
 * persona.
 */
function buildAgentConfigsPrompt(opts: {
  projectRoot: string
  framework?: FrameworkInfo | null
  totalPersonas: number
}): string {
  const { projectRoot, framework, totalPersonas } = opts
  return [
    `Your task: edit \`.annotask/agents.json\` and fill in \`projectDirections\` for every agent. Use your file-editing tool (Edit / Write / patch) — do NOT just describe what you would write; actually modify the file on disk.`,
    ``,
    `You may ONLY edit the \`projectDirections\` field. The \`providerId\`, \`model\`, and \`effort\` fields are owned by Annotask — do not invent values, do not copy values from other personas, do not change them. Annotask rewrites those fields after you finish, regardless of what you write.`,
    ``,
    `Step 1 — read these files to ground the directions in the real codebase:`,
    `  - .annotask/agents.json  (you'll edit this; every \`projectDirections\` is currently "")`,
    `  - package.json           (framework, deps, scripts)`,
    `  - README.md              (if present — what this app is for)`,
    `  - 2-3 representative source files in src/ or app/ to confirm conventions`,
    ``,
    `Step 2 — for each of the ${totalPersonas} personas listed below, write ONE cohesive markdown blob (4-8 sentences, prose not bullets) that combines:`,
    `  • The agent's identity and tone, rephrased in your own words to fit this project (do NOT paste the example sentence verbatim).`,
    `  • Concrete project facts you confirmed by reading files: framework + version, styling system, component library, naming conventions, things to prefer or avoid.`,
    ``,
    `Personas to fill (id → tone example to draw from, then what to ground each in):`,
    ...BUILT_IN_PERSONAS.flatMap(p => [
      `  ${p.id} (${p.name}):`,
      `    tone example: ${p.roleDirections}`,
      `    must cover: ${PERSONA_GROUND_HINTS[p.id] ?? 'identity + project-specific guidance'}`,
    ]),
    ``,
    `Step 3 — write the file using your Edit/Write tool. Preserve the JSON shape exactly. Only \`projectDirections\` is yours to edit:`,
    `  { "version": 1, "agents": { "<id>": { "projectDirections": "<your blob>", "providerId": "<leave as-is>", "model": "<leave as-is>", "effort": "<leave as-is>" }, ... } }`,
    `Do NOT add or remove personas. Do NOT leave any \`projectDirections\` empty.`,
    ``,
    `Step 4 — re-read \`.annotask/agents.json\` to confirm every \`projectDirections\` is a non-empty string with project-specific content.`,
    ``,
    `Project: ${projectRoot}`,
    `Framework: ${framework?.name ?? 'unknown'}${framework?.version ? ` ${framework.version}` : ''}`,
    `Styling: ${(framework?.styling ?? []).join(', ') || 'standard CSS'}`,
  ].join('\n')
}

export const __test = { selectInitCli, enforceSelectedRuntime, buildAgentConfigsPrompt }

export function createInitRunner(deps: Deps): InitRunner {
  let state: InitState = freshState()
  let cancelRequested = false
  let agentAbortController: AbortController | null = null
  // One id per `start()` run so all CLI invocations within a single init
  // (design-spec, agent-configs) cluster together in the ledger.
  let currentRunId: string | null = null

  function recordInitUsage(label: string, providerId: string, usage: SpawnUsage): void {
    // Accumulate into the wizard's live counter regardless of whether the
    // ledger is wired — the user-facing tally should still update during
    // tests / dev that don't provide a ledger.
    const prev = state.tokenUsage ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      turns: 0,
    }
    state.tokenUsage = {
      inputTokens: prev.inputTokens + Math.max(0, usage.inputTokens || 0),
      outputTokens: prev.outputTokens + Math.max(0, usage.outputTokens || 0),
      cacheReadTokens: prev.cacheReadTokens + Math.max(0, usage.cacheReadTokens || 0),
      cacheCreationTokens: prev.cacheCreationTokens + Math.max(0, usage.cacheCreationTokens || 0),
      turns: prev.turns + 1,
    }
    broadcastProgress()
    if (!deps.usageLedger) return
    void deps.usageLedger.append({
      scope: 'init',
      runId: currentRunId ?? undefined,
      providerId,
      model: usage.model,
      label,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
    })
  }

  function freshState(): InitState {
    return {
      running: false,
      steps: SCAN_STEPS.map(d => ({ id: d.id, label: d.label, status: 'pending' as const })),
      agentLines: [],
    }
  }

  function broadcastProgress() {
    deps.broadcast('init:progress', {
      ...state,
      steps: state.steps.map(s => ({ ...s })),
      draft: state.draft,
      agentLines: state.agentLines ?? [],
      tokenUsage: state.tokenUsage,
    })
  }

  function setStep(id: string, patch: Partial<InitStep>) {
    state.steps = state.steps.map(s => s.id === id ? { ...s, ...patch } : s)
    broadcastProgress()
  }

  function appendAgentLine(line: string) {
    state.agentLines = [...(state.agentLines ?? []).slice(-499), line]
    broadcastProgress()
  }

  async function runStep<T>(id: string, fn: () => Promise<T>, skip = false): Promise<T | undefined> {
    if (skip) {
      setStep(id, { status: 'skipped', message: 'Skipped', finishedAt: Date.now() })
      return undefined
    }
    if (cancelRequested) {
      setStep(id, { status: 'skipped', message: 'Cancelled' })
      return undefined
    }
    setStep(id, { status: 'running', startedAt: Date.now() })
    try {
      const result = await fn()
      setStep(id, { status: 'success', finishedAt: Date.now() })
      return result
    } catch (err) {
      const message = (err as Error)?.message ?? String(err)
      setStep(id, { status: 'error', finishedAt: Date.now(), message })
      throw err
    }
  }

  function start(opts: ScanOptions = {}): InitState {
    if (state.running) return state
    cancelRequested = false
    currentRunId = `init-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    state = { ...freshState(), running: true, startedAt: Date.now() }
    broadcastProgress()

    runPipeline(opts).catch(err => {
      state.result = 'error'
      state.error = (err as Error)?.message ?? String(err)
      state.finishedAt = Date.now()
      state.running = false
      broadcastProgress()
    })

    return state
  }

  function cancel() {
    if (!state.running) return
    cancelRequested = true
    agentAbortController?.abort()
  }

  function getState(): InitState {
    return {
      ...state,
      steps: state.steps.map(s => ({ ...s })),
      draft: state.draft,
      agentLines: state.agentLines ?? [],
      tokenUsage: state.tokenUsage,
    }
  }

  async function runPipeline(opts: ScanOptions = {}) {
    // When `skipAgentScan` is set we always need framework + theme detection
    // for downstream context, but they're cheap deterministic scans, so just
    // run them as usual. The LLM-driven `agent-scan` step is the one that's
    // actually skipped — see runStep below.
    const cssFiles = await collectCssFiles(deps.projectRoot)

    const framework = await runStep('framework', () => detectFramework(deps.projectRoot), opts.skipAgentScan)
    if (cancelRequested) return finishCancelled()

    const themes = await runStep('themes', () => detectThemeVariants(cssFiles), opts.skipAgentScan)
    if (cancelRequested) return finishCancelled()

    const themeList = themes?.themes ?? [{ id: 'default', name: 'Default', selector: { kind: 'default' } }]
    const defaultTheme = themes?.defaultTheme ?? 'default'

    // ── Agent-driven token extraction ────────────────────────────────────────
    let agentUsed = false
    let initCliUsed: InitCliOption | null = null
    // Re-scan mode may skip the heavy agent-scan step entirely. When skipped,
    // we still set `agentUsed` to true so the downstream draft-assembly path
    // reads the existing design-spec.json from disk instead of falling back
    // to the empty scaffold.
    if (opts.skipAgentScan) {
      agentUsed = true
    }
    await runStep('agent-scan', async () => {
      const snap = await deps.agentDetect.detect()
      const available = selectInitCli(snap, opts.requestedProviderId)

      if (!available) {
        setStep('agent-scan', {
          message: 'No local CLI logged in — running lightweight scanner (colors and layout only)',
        })
        await runFallbackScan(cssFiles, themeList)
        return
      }

      state.agentCli = available.label
      initCliUsed = available
      const runtime = narrowRuntimeToCli(available, opts)
      if (runtime.substituted) {
        appendAgentLine(
          `Init substituted ${available.label} for requested provider "${opts.requestedProviderId}". ` +
          `Dropping requested model "${opts.requestedModel ?? ''}" — that id is in the wrong namespace ` +
          `for ${available.bin}. ${available.label} will use its CLI default.`,
        )
      }
      const modelSuffix = runtime.model?.trim() ? ` (${runtime.model.trim()})` : ''
      setStep('agent-scan', { message: `Running annotask-init with ${available.label}${modelSuffix}…` })

      let skillBody = ''
      try {
        const skill = loadSkill('annotask-init')
        skillBody = skill.body
      } catch {
        skillBody = 'Initialize Annotask for this project. Write `.annotask/design-spec.json` following the annotask design-spec schema.'
      }

      const styleGuidePath2 = path.join(deps.projectRoot, '.annotask', 'STYLE_GUIDE.md')
      let preexistingGuide: string | null = null
      try { preexistingGuide = await fsp.readFile(styleGuidePath2, 'utf-8') } catch { /* not present */ }

      const userMessage = [
        `Initialize Annotask for this project. Do both of the following:`,
        ``,
        `1. Write the complete \`.annotask/design-spec.json\` file with all detected design tokens.`,
        ``,
        `2. Write \`.annotask/STYLE_GUIDE.md\` — a project style guide agents read before every task.`,
        `   Use the existing one if present (path: .annotask/STYLE_GUIDE.md) and update it,`,
        `   otherwise create it from scratch with sections: Naming conventions, Spacing & layout,`,
        `   Component patterns, Things to avoid, Project context.`,
        `   Fill in what you can infer from the codebase; leave sections blank rather than guessing.`,
        preexistingGuide ? `   Existing STYLE_GUIDE.md content:\n${preexistingGuide.slice(0, 2000)}` : '',
        ``,
        `Project context:`,
        `  Root: ${deps.projectRoot}`,
        `  Framework: ${framework?.name ?? 'unknown'}${framework?.version ? ` ${framework.version}` : ''}`,
        `  Styling: ${(framework?.styling ?? []).join(', ') || 'standard CSS'}`,
        `  Detected theme variants: ${themeList.map(t => t.id).join(', ')}`,
      ].filter(l => l !== null).join('\n')

      const specPath = path.join(deps.projectRoot, '.annotask', 'design-spec.json')

      await spawnCliWithSkill({
        bin: available.bin,
        model: runtime.model,
        effort: runtime.effort,
        skillBody,
        userMessage,
        projectRoot: deps.projectRoot,
        onLine: (line) => { appendAgentLine(line) },
        onUsage: (u) => recordInitUsage('annotask-init', `${available.bin}-local`, u),
        signal: (agentAbortController = new AbortController()).signal,
      })

      agentUsed = true

      // Verify the agent wrote the spec file
      try {
        await fsp.access(specPath)
        const guideWritten = await fsp.access(styleGuidePath2).then(() => true).catch(() => false)
        setStep('agent-scan', {
          message: `${available.label} wrote design-spec.json${guideWritten ? ' + STYLE_GUIDE.md' : ''}`,
        })
      } catch {
        setStep('agent-scan', {
          status: 'error',
          message: `${available.label} exited but design-spec.json was not found — running fallback`,
        })
        await runFallbackScan(cssFiles, themeList)
        agentUsed = false
      }
    }, opts.skipAgentScan)
    if (cancelRequested) return finishCancelled()

    // ── Agent directions — separate CLI invocation ───────────────────────────
    await runStep('agent-configs', async () => {
      const agentConfigsPath = path.join(deps.projectRoot, '.annotask', 'agents.json')

      // Use the exact provider/model/effort selected in the init-agent step
      // for every built-in runtime agent. The local CLI below is only the
      // writer used to fill projectDirections; it does not get to choose each
      // persona's runtime model.
      const available = initCliUsed ?? selectInitCli(await deps.agentDetect.detect(), opts.requestedProviderId)
      // Resolution priority for the per-built-in runtime: explicit request →
      // detected CLI → persona's own default. We deliberately never fall back
      // to whatever value is currently sitting in agents.json — re-init with a
      // different provider must overwrite prior Claude defaults.
      const resolvedProviderId: ProviderId = opts.requestedProviderId
        ?? available?.id
        ?? BUILT_IN_PERSONAS[0].providerId
      const allowedEfforts = EFFORTS_BY_PROVIDER[resolvedProviderId] ?? EFFORT_LEVELS
      const allowedEffortSet = new Set<EffortLevel>(allowedEfforts)
      const selectedModel = opts.requestedModel?.trim() ?? ''
      const selectedEffort: EffortLevel = opts.requestedEffort && allowedEffortSet.has(opts.requestedEffort)
        ? opts.requestedEffort
        : 'auto'

      if (!agentUsed) {
        await enforceSelectedRuntime({
          filePath: agentConfigsPath,
          providerId: resolvedProviderId,
          model: selectedModel,
          effort: selectedEffort,
          fallbackRoleText: true,
        })
        setStep('agent-configs', { message: 'Seeded default agent roles — edit in Settings → Agents.' })
        return
      }

      if (!available) {
        await enforceSelectedRuntime({
          filePath: agentConfigsPath,
          providerId: resolvedProviderId,
          model: selectedModel,
          effort: selectedEffort,
          fallbackRoleText: true,
        })
        setStep('agent-configs', { message: 'No CLI available — seeded default roles. Edit in Settings → Agents.' })
        return
      }

      // Seed runtime config only. projectDirections stays empty so the CLI
      // is forced to write fresh project-tailored content rather than copy
      // the built-in role text it sees in the file.
      await enforceSelectedRuntime({
        filePath: agentConfigsPath,
        providerId: resolvedProviderId,
        model: selectedModel,
        effort: selectedEffort,
        fallbackRoleText: false,
      })

      const runtime = narrowRuntimeToCli(available, opts)
      if (runtime.substituted) {
        appendAgentLine(
          `Init substituted ${available.label} for requested provider "${opts.requestedProviderId}". ` +
          `Dropping requested model "${opts.requestedModel ?? ''}" — that id is in the wrong namespace ` +
          `for ${available.bin}. ${available.label} will use its CLI default.`,
        )
      }
      const modelSuffix = runtime.model?.trim() ? ` (${runtime.model.trim()})` : ''
      setStep('agent-configs', { message: `Writing agent directions with ${available.label}${modelSuffix}…` })

      const agentConfigsMessage = buildAgentConfigsPrompt({
        projectRoot: deps.projectRoot,
        framework,
        totalPersonas: BUILT_IN_PERSONAS.length,
      })

      // Run the CLI inside its own try/catch so a failure (timeout, non-zero
      // exit, network error) doesn't bypass the backfill. Without this, a
      // failed CLI leaves every projectDirections as the empty string we
      // seeded — the user sees totally blank agent settings.
      let cliError: Error | null = null
      try {
        await spawnCliWithSkill({
          bin: available.bin,
          model: runtime.model,
          effort: runtime.effort,
          skillBody: '',
          userMessage: agentConfigsMessage,
          projectRoot: deps.projectRoot,
          onLine: (line) => { appendAgentLine(line) },
          onUsage: (u) => recordInitUsage('agent-configs', `${available.bin}-local`, u),
          signal: (agentAbortController = new AbortController()).signal,
        })
      } catch (err) {
        cliError = err as Error
        appendAgentLine(`[error] ${cliError.message}`)
      }

      // Re-open the file and forcibly restore the selected provider/model/effort
      // in case the CLI rewrote them. Backfills empty projectDirections with
      // the built-in role text so the user never sees a totally blank entry.
      try {
        const { backfilled, filled, totalBuiltIns } = await enforceSelectedRuntime({
          filePath: agentConfigsPath,
          providerId: resolvedProviderId,
          model: selectedModel,
          effort: selectedEffort,
          fallbackRoleText: true,
        })
        const snapNotes: string[] = []
        if (backfilled > 0) snapNotes.push(`${backfilled} fell back to role default`)
        const baseMsg = snapNotes.length > 0
          ? `${filled} of ${totalBuiltIns} agent personas configured (${snapNotes.join(', ')})`
          : `${filled} of ${totalBuiltIns} agent personas configured`
        const msg = cliError ? `${baseMsg}. ${available.label} errored: ${cliError.message.slice(0, 120)}` : baseMsg
        setStep('agent-configs', { message: msg })
      } catch {
        // CLI munged the file beyond JSON-readability — restore role text
        // as a safety net so the user has something to edit in Settings.
        await enforceSelectedRuntime({
          filePath: agentConfigsPath,
          providerId: resolvedProviderId,
          model: selectedModel,
          effort: selectedEffort,
          fallbackRoleText: true,
        })
        setStep('agent-configs', { message: 'agents.json was unreadable — restored default roles. Edit in Settings → Agents.' })
      }
    }, opts.skipAgentConfigs)
    if (cancelRequested) return finishCancelled()

    const components = await runStep('components', async () => {
      const catalog = await scanComponentLibraries(deps.projectRoot)
      return summarizeComponents(catalog, framework?.name)
    }, opts.skipComponents)
    if (cancelRequested) return finishCancelled()

    await runStep('data-sources', async () => {
      const catalog = await scanDataSources(deps.projectRoot)
      return catalog.project_entries.length
    }, opts.skipDataSources)
    if (cancelRequested) return finishCancelled()

    await runStep('api-schemas', async () => {
      const catalog = await scanApiSchemas(deps.projectRoot)
      return catalog.schemas.length
    }, opts.skipApiSchemas)
    if (cancelRequested) return finishCancelled()

    // ── Assemble draft ──────────────────────────────────────────────────────
    const specPath = path.join(deps.projectRoot, '.annotask', 'design-spec.json')
    let draftSpec: Record<string, unknown>

    if (agentUsed) {
      // Agent wrote the file — read it as the draft
      try {
        const raw = await fsp.readFile(specPath, 'utf-8')
        const parsed = JSON.parse(raw)
        // Merge scanner-detected components into the agent-written spec when missing
        if (!parsed.components && components) parsed.components = components
        draftSpec = parsed
      } catch {
        draftSpec = baseDraftSpec(framework, themeList, defaultTheme, components)
      }
    } else {
      // Fallback: read what the fallback scanner wrote, or build from scratch
      draftSpec = state.draft?.spec ?? baseDraftSpec(framework, themeList, defaultTheme, components)
    }

    const styleGuidePath = path.join(deps.projectRoot, '.annotask', 'STYLE_GUIDE.md')
    let existingGuide: string | null = null
    try { existingGuide = await fsp.readFile(styleGuidePath, 'utf-8') } catch { /* not present */ }

    let designSpecExists = false
    try { await fsp.access(specPath); designSpecExists = true } catch { /* fine */ }

    // If the run only touched agent-configs (everything else explicitly
    // skipped), there's no draft for the user to review — skip the Review
    // step entirely and let the wizard show a plain "done" state. We still
    // populate state.draft for consistency with the read endpoints, but the
    // result below will be 'success' rather than 'awaiting_review'.
    const onlyAgentConfigsRan = !!(opts.skipAgentScan && opts.skipComponents && opts.skipDataSources && opts.skipApiSchemas) && !opts.skipAgentConfigs

    state.draft = {
      spec: draftSpec,
      styleGuide: existingGuide ?? STYLE_GUIDE_TEMPLATE,
      styleGuideExists: existingGuide != null,
      designSpecExists,
    }
    state.result = onlyAgentConfigsRan ? 'success' : 'awaiting_review'
    state.finishedAt = Date.now()
    state.running = false
    broadcastProgress()
  }

  async function runFallbackScan(
    cssFiles: string[],
    themes: Array<{ id: string; selector: Record<string, unknown> }>,
  ) {
    // Lightweight CSS scanner for when no CLI is available.
    // Extracts CSS custom properties and uses them to build a minimal spec.
    // The design-spec.json is NOT written to disk during fallback scan —
    // only the draft state is populated so the user can still review.
    const fallbackSpec = baseDraftSpec(null, themes, themes[0]?.id ?? 'default', null)
    state.draft = {
      spec: fallbackSpec,
      styleGuide: STYLE_GUIDE_TEMPLATE,
      styleGuideExists: false,
      designSpecExists: false,
    }
    broadcastProgress()
  }

  async function commit(body: InitCommitBody): Promise<InitState> {
    if (!state.draft) {
      state = { ...state, result: 'error', error: 'No draft to commit — run start() first.', finishedAt: Date.now(), running: false }
      broadcastProgress()
      return getState()
    }

    // Mark the spec as user-accepted. `state.ts` only treats the spec as
    // "initialized" when this field is explicitly `true` — an agent-written
    // spec without it keeps the wizard open until the user commits here.
    const rawSpec = body.spec ?? state.draft.spec
    const spec = { ...rawSpec, initialized: true }
    const styleGuide = body.styleGuide ?? state.draft.styleGuide
    const overwriteStyleGuide = body.overwriteStyleGuide === true

    const specPath = path.join(deps.projectRoot, '.annotask', 'design-spec.json')
    const stylePath = path.join(deps.projectRoot, '.annotask', 'STYLE_GUIDE.md')

    try {
      await fsp.mkdir(path.dirname(specPath), { recursive: true })
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), 'utf-8')
      if (state.draft.styleGuideExists && !overwriteStyleGuide) {
        // preserve existing
      } else {
        await fsp.writeFile(stylePath, styleGuide, 'utf-8')
      }
      state = { ...state, result: 'success', committedAt: Date.now(), draft: { ...state.draft, spec, styleGuide } }
      broadcastProgress()
    } catch (err) {
      state = { ...state, result: 'error', error: (err as Error)?.message ?? String(err) }
      broadcastProgress()
    }
    return getState()
  }

  async function skip(): Promise<InitState> {
    // Write the minimal accepted spec and close. The user will run the
    // annotask-init skill in their editor agent to populate tokens.
    const existing = state.draft?.spec
    const specPath = path.join(deps.projectRoot, '.annotask', 'design-spec.json')
    let baseSpec: Record<string, unknown>
    if (existing) {
      baseSpec = { ...existing, initialized: true }
    } else {
      // Read the on-disk spec if present, else build a blank one.
      try {
        const raw = JSON.parse(await fsp.readFile(specPath, 'utf-8'))
        baseSpec = { ...raw, initialized: true }
      } catch {
        baseSpec = { version: '1.0', initialized: true, colors: [], typography: { families: [], scale: [], weights: [] }, spacing: [], borders: { radius: [] } }
      }
    }
    try {
      await fsp.mkdir(path.dirname(specPath), { recursive: true })
      await fsp.writeFile(specPath, JSON.stringify(baseSpec, null, 2), 'utf-8')
      state = { ...state, result: 'success', committedAt: Date.now() }
      broadcastProgress()
    } catch (err) {
      state = { ...state, result: 'error', error: (err as Error)?.message ?? String(err) }
      broadcastProgress()
    }
    return getState()
  }

  function finishCancelled() {
    agentAbortController?.abort()
    state.result = 'cancelled'
    state.finishedAt = Date.now()
    state.running = false
    broadcastProgress()
  }

  return { start, cancel, commit, skip, getState }
}

// ─── CLI agent spawn ──────────────────────────────────────────────────────────

interface SpawnUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  model?: string
}

interface SpawnCliOpts {
  bin: string
  model?: string
  effort?: EffortLevel
  skillBody: string
  userMessage: string
  projectRoot: string
  onLine: (line: string) => void
  /**
   * Fires once per usage-bearing line emitted by the CLI. Most CLIs report
   * usage on completion (claude `result`, codex `turn.completed`); some emit
   * incremental updates. Each call carries the delta or final total reported
   * on that line — the caller decides whether to sum or replace.
   */
  onUsage?: (usage: SpawnUsage) => void
  signal: AbortSignal
}

const AGENT_TIMEOUT_MS = 5 * 60_000  // 5 minutes — annotask-init can take a while on large projects

async function spawnCliWithSkill(opts: SpawnCliOpts): Promise<void> {
  const { bin, model, effort, skillBody, userMessage, projectRoot, onLine, onUsage, signal } = opts
  const isAborted = () => signal.aborted
  const modelArg = model?.trim()

  const args: string[] = []
  let stdin: string | undefined

  if (bin === 'claude') {
    // Claude Code CLI: --print reads from stdin, flattened System:/User: format.
    // --permission-mode bypassPermissions: init is an explicit user action that only
    // writes inside .annotask/ — safe to skip the interactive permission prompt.
    args.push('--print', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'bypassPermissions')
    if (modelArg) args.push('--model', modelArg)
    stdin = `${skillBody}\n\nUser: ${userMessage}`
  } else if (bin === 'codex') {
    // Codex: positional prompt with skill prepended
    args.push('exec', '--json')
    if (modelArg) args.push('--model', modelArg)
    if (effort && effort !== 'auto' && effort !== 'minimal') {
      args.push('-c', `model_reasoning_effort=${effort}`)
    }
    args.push(`${skillBody}\n\n---\n\n${userMessage}`)
  } else if (bin === 'copilot') {
    // GitHub Copilot CLI: `-p <prompt>` for non-interactive, JSON event
    // stream on stdout. `--allow-all-tools` is mandatory for `-p` per the
    // CLI's help; `--no-ask-user` keeps it from emitting synthesized
    // clarifying questions that have nowhere to go in headless mode.
    args.push('--output-format', 'json', '--allow-all-tools', '--no-ask-user')
    if (modelArg) args.push('--model', modelArg)
    if (effort && effort !== 'auto' && effort !== 'minimal') {
      args.push('--reasoning-effort', effort)
    }
    args.push('-p', `${skillBody}\n\n---\n\n${userMessage}`)
  } else {
    // opencode: run with positional prompt
    args.push('run', '--print-logs', '--format=json')
    if (modelArg) args.push('--model', modelArg)
    args.push(`${skillBody}\n\n---\n\n${userMessage}`)
  }

  return new Promise<void>((resolve, reject) => {
    if (isAborted()) { reject(new Error('Cancelled')); return }

    const child = spawn(bin, args, {
      cwd: projectRoot,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (stdin) {
      child.stdin.write(stdin)
      child.stdin.end()
    } else {
      child.stdin.end()
    }

    let stdoutBuf = ''
    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk
      let nl: number
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl)
        stdoutBuf = stdoutBuf.slice(nl + 1)
        const trimmed = line.trim()
        const text = extractTextFromLine(bin, trimmed)
        if (text) onLine(text)
        if (onUsage) {
          const u = extractUsageFromLine(bin, trimmed)
          if (u) onUsage(u)
        }
      }
    })

    let stderrBuf = ''
    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk: string) => { stderrBuf += chunk })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ } }, 2_000).unref()
      reject(new Error(`Agent timed out after ${AGENT_TIMEOUT_MS / 1000}s`))
    }, AGENT_TIMEOUT_MS)
    timer.unref()

    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      try { child.kill('SIGTERM') } catch { /* ignore */ }
    }, { once: true })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (isAborted()) { reject(new Error('Cancelled')); return }
      if (code === 0 || code === null) {
        resolve()
      } else {
        reject(new Error(`Agent exited with code ${code}. stderr: ${stderrBuf.slice(0, 500)}`))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * Extract displayable text from a CLI output line.
 * Claude outputs stream-json events; codex/opencode also output JSON.
 * If we can't parse it, return the raw line (truncated).
 */
function extractTextFromLine(bin: string, line: string): string | null {
  if (!line) return null
  try {
    const ev = JSON.parse(line) as any
    // Claude stream-json
    if (ev.type === 'assistant' && ev.message?.content) {
      const texts = (ev.message.content as any[]).filter(b => b.type === 'text').map(b => b.text)
      return texts.join('') || null
    }
    // Codex item_completed with text
    if (ev.type === 'item.completed' && ev.item?.text) return String(ev.item.text)
    // opencode
    if (ev.type === 'message' && ev.content) return String(ev.content)
    // Copilot CLI: stream events from `copilot --output-format json`.
    //   • assistant.message_delta carries per-chunk text in data.deltaContent
    //   • assistant.message carries the cumulative text in data.content — we
    //     skip it to avoid duplicating the deltas (matches CopilotLocalProvider).
    if (bin === 'copilot' && ev.type === 'assistant.message_delta'
        && typeof ev.data?.deltaContent === 'string'
        && ev.data.deltaContent.length > 0) {
      return ev.data.deltaContent
    }
    return null
  } catch {
    // Not JSON — surface non-trivial plaintext lines
    return line.length > 5 && !line.startsWith('{') ? line : null
  }
}

/**
 * Extract token usage from a CLI output line. Mirrors the per-CLI shapes the
 * embedded providers parse (claude-local-provider, codex-local-provider,
 * opencode-local-provider) so the init pipeline reports usage with the same
 * fidelity as a live chat turn.
 */
function extractUsageFromLine(bin: string, line: string): SpawnUsage | null {
  if (!line || !line.startsWith('{')) return null
  let ev: any
  try { ev = JSON.parse(line) } catch { return null }
  if (!ev || typeof ev !== 'object') return null
  if (bin === 'claude') {
    // The `result` line carries the final cumulative totals; `message_start`
    // and intermediate `message` events also carry running totals. We only
    // emit on `result` to avoid double-counting — init runs are one-shot.
    if (ev.type === 'result' && ev.usage) {
      const u = ev.usage
      return {
        inputTokens: numberOr(u.input_tokens, 0),
        outputTokens: numberOr(u.output_tokens, 0),
        cacheReadTokens: numberOr(u.cache_read_input_tokens, undefined),
        cacheCreationTokens: numberOr(u.cache_creation_input_tokens, undefined),
        model: typeof ev.model === 'string' ? ev.model : undefined,
      }
    }
    return null
  }
  if (bin === 'codex') {
    if (ev.type === 'turn.completed' && ev.usage) {
      const u = ev.usage
      return {
        inputTokens: numberOr(u.input_tokens, 0),
        outputTokens: numberOr(u.output_tokens, 0),
        cacheReadTokens: numberOr(u.cached_input_tokens, undefined),
        model: typeof ev.model === 'string' ? ev.model : undefined,
      }
    }
    return null
  }
  if (bin === 'copilot') {
    // Copilot CLI surfaces only outputTokens per assistant message; no
    // input-token count is exposed. The terminal `result` event carries
    // timing/premiumRequests but no token totals — see
    // src/embedded/copilot-local-provider.ts for the same contract.
    if (ev.type === 'assistant.message' && typeof ev.data?.outputTokens === 'number') {
      return {
        inputTokens: 0,
        outputTokens: numberOr(ev.data.outputTokens, 0),
        model: typeof ev.data?.model === 'string' ? ev.data.model : undefined,
      }
    }
    return null
  }
  // opencode emits usage on the closing event of each turn; shape matches
  // its OpenAI-compatible payload.
  if (ev.usage && (ev.usage.input_tokens || ev.usage.output_tokens)) {
    const u = ev.usage
    return {
      inputTokens: numberOr(u.input_tokens, 0),
      outputTokens: numberOr(u.output_tokens, 0),
      model: typeof ev.model === 'string' ? ev.model : undefined,
    }
  }
  return null
}

function numberOr<T>(v: unknown, fallback: T): number | T {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
}

// ─── Framework detection ──────────────────────────────────────────────────────

interface FrameworkInfo { name: string; version?: string; styling: string[] }

async function detectFramework(projectRoot: string): Promise<FrameworkInfo> {
  let pkg: any = {}
  try { pkg = JSON.parse(await fsp.readFile(path.join(projectRoot, 'package.json'), 'utf-8')) } catch { return { name: 'unknown', styling: [] } }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }

  let name = 'unknown'
  let version: string | undefined
  if (deps.vue)             { name = 'vue';    version = String(deps.vue).replace(/^\^|~/, '') }
  else if (deps.react)      { name = 'react';  version = String(deps.react).replace(/^\^|~/, '') }
  else if (deps.svelte)     { name = 'svelte'; version = String(deps.svelte).replace(/^\^|~/, '') }
  else if (deps['solid-js'])  { name = 'solid';  version = String(deps['solid-js']).replace(/^\^|~/, '') }
  else if (deps.astro)      { name = 'astro';  version = String(deps.astro).replace(/^\^|~/, '') }

  const styling: string[] = []
  if (deps.tailwindcss || deps['@tailwindcss/vite']) styling.push('tailwind')
  if (name === 'vue') styling.push('scoped-css')
  if (Object.keys(deps).some(d => /css-modules?/.test(d))) styling.push('css-modules')
  return { name, version, styling }
}

// ─── Theme variant detection ──────────────────────────────────────────────────

interface ThemeVariantDetection {
  themes: Array<{ id: string; name: string; scheme?: string; selector: Record<string, unknown> }>
  defaultTheme: string
}

async function detectThemeVariants(cssFiles: string[]): Promise<ThemeVariantDetection> {
  let combined = ''
  for (const file of cssFiles.slice(0, 60)) {
    try { combined += '\n' + await fsp.readFile(file, 'utf-8') } catch { /* skip */ }
  }

  const hasDarkClass = /(?::root|html|body)\.dark\b/.test(combined) || /(?:html|body)\.dark\s*\{/.test(combined)
  const dataThemeMatch = combined.match(/\[data-theme="([^"]+)"\]/g)
  const hasMediaDark = /@media\s*\(prefers-color-scheme:\s*dark\)/.test(combined)

  if (hasDarkClass) return {
    themes: [
      { id: 'light', name: 'Light', scheme: 'light', selector: { kind: 'default' } },
      { id: 'dark',  name: 'Dark',  scheme: 'dark',  selector: { kind: 'class', host: 'html', name: 'dark' } },
    ], defaultTheme: 'light',
  }

  if (dataThemeMatch?.length) {
    const values = new Set<string>()
    for (const m of dataThemeMatch) {
      const v = m.match(/\[data-theme="([^"]+)"\]/)?.[1]
      if (v) values.add(v)
    }
    const themes = Array.from(values).map(v => ({
      id: v, name: v.charAt(0).toUpperCase() + v.slice(1),
      selector: { kind: 'attribute', host: 'html', name: 'data-theme', value: v },
    }))
    if (themes.length) return { themes, defaultTheme: themes[0].id }
  }

  if (hasMediaDark) return {
    themes: [
      { id: 'light', name: 'Light', scheme: 'light', selector: { kind: 'default' } },
      { id: 'dark',  name: 'Dark',  scheme: 'dark',  selector: { kind: 'media', media: '(prefers-color-scheme: dark)' } },
    ], defaultTheme: 'light',
  }

  return { themes: [{ id: 'default', name: 'Default', selector: { kind: 'default' } }], defaultTheme: 'default' }
}

// ─── File collection ──────────────────────────────────────────────────────────

async function collectCssFiles(projectRoot: string): Promise<string[]> {
  const out: string[] = []
  for (const root of ['src', 'app', 'styles', 'assets', 'public']) {
    await walk(path.join(projectRoot, root), out, ['.css', '.scss', '.sass', '.vue', '.svelte', '.astro'])
  }
  return out
}

async function walk(dir: string, out: string[], exts: string[], depth = 0): Promise<void> {
  if (depth > 6) return
  let entries: import('node:fs').Dirent[]
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'dist') continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) await walk(full, out, exts, depth + 1)
    else if (exts.some(e => ent.name.endsWith(e))) out.push(full)
  }
}

// ─── Component library ────────────────────────────────────────────────────────

const FRAMEWORK_LIBRARY_PATTERNS: Record<string, RegExp> = {
  vue:    /vue|primevue|quasar|nuxt|naive-ui|radix-vue|vueuse|headlessui|oruga|varlet|element-plus|ant-design-vue|vant/i,
  react:  /react|mantine|chakra|radix-ui|shadcn|antd|material-ui|@mui|headlessui|nextui|tremor|ark-ui/i,
  svelte: /svelte|bits-ui|shadcn-svelte/i,
  solid:  /solid|kobalte/i,
  astro:  /astro/i,
}

function summarizeComponents(catalog: any, frameworkName?: string): Record<string, unknown> | null {
  const libs: any[] = Array.isArray(catalog?.libraries) ? catalog.libraries : []
  if (libs.length === 0) return null

  let candidates = libs
  if (frameworkName) {
    const pattern = FRAMEWORK_LIBRARY_PATTERNS[frameworkName]
    if (pattern) {
      const matching = libs.filter(l => pattern.test(l.name))
      if (matching.length > 0) candidates = matching
    }
  }

  const primary = candidates.slice().sort((a, b) => (b.components?.length ?? 0) - (a.components?.length ?? 0))[0]
  if (!primary) return null
  if (!primary.name) return null
  return { library: primary.name, version: primary.version, used: [] }
}

// ─── Draft helpers ────────────────────────────────────────────────────────────

function baseDraftSpec(
  framework: FrameworkInfo | null | undefined,
  themes: Array<{ id: string; selector: Record<string, unknown> }>,
  defaultTheme: string,
  components: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return {
    version: '1.0',
    framework: framework ?? { name: 'unknown', version: '', styling: [] },
    themes,
    defaultTheme,
    colors: [],
    typography: { families: [], scale: [], weights: [] },
    spacing: [],
    borders: { radius: [] },
    breakpoints: {},
    icons: null,
    components: components ?? null,
  }
}

// ─── Style guide template ────────────────────────────────────────────────────

const STYLE_GUIDE_TEMPLATE = `# Project style guide

Annotask agents read this file before applying tasks. Fill in the sections
below to teach them your project's conventions. Empty sections are fine —
agents will fall back to inferring from the existing code.

## Naming conventions

<!-- e.g. PascalCase components, camelCase composables, kebab-case CSS classes -->

## Spacing & layout

<!-- e.g. 4px base unit; cards use --space-md padding; grid is 12-column -->

## Component patterns

<!-- e.g. wrap form inputs in <FormField label="…">; use <Button variant="primary"> -->

## Things to avoid

<!-- e.g. don't add new dependencies; don't refactor for cleanliness; preserve inline styles -->

## Project context

<!-- A sentence or two about what this project is for. Helps agents pick tone in copy edits. -->
`
