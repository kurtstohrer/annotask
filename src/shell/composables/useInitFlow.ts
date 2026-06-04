/**
 * Drives the InitWizard overlay. Subscribes to the server's `init:progress`
 * WS topic and exposes a state machine for the 4-step UI:
 *   0. `mode`   — choose skill/MCP vs embedded-agent workflow (first run only).
 *   1. `agent`  — pick the provider the embedded agent will run through.
 *   2. `scan`   — server runs the scanners; emits step-by-step progress.
 *   3. `review` — user edits the assembled draft (themes, style guide),
 *                 then commits to disk.
 *
 * Visibility: the wizard auto-opens when the user hasn't yet chosen a workflow
 * (`embeddedAgentEnabled === null`) or has chosen embedded but the project
 * has no design-spec (`isInitialized === false` from useDesignSpec). When
 * `embeddedAgentEnabled === false` the wizard never auto-opens — the user is
 * in skill/MCP mode and drives init from their editor agent.
 */

import { ref, computed, watch } from 'vue'
import { on as wsOn } from '../services/wsClient'
import { useDesignSpec } from './useDesignSpec'
import { useProviderSettings } from './useProviderSettings'
import type { EffortLevel, ProviderId } from '../../embedded/provider-config'

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
  spec: Record<string, any>
  styleGuide: string
  styleGuideExists: boolean
  designSpecExists: boolean
}

export interface InitTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  turns: number
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
  agentLines?: string[]
  agentCli?: string
  /** Live token tally for this init run, accumulated across all CLI calls. */
  tokenUsage?: InitTokenUsage
}

export type WizardStep = 'mode' | 'agent' | 'scan' | 'review'

export interface ScanOptions {
  /** Skip the LLM design-spec pass. Set in re-scan mode when the user only
   *  wants to refresh agent-configs or recompute static catalogs without
   *  rewriting design-spec.json + STYLE_GUIDE.md. */
  skipAgentScan?: boolean
  skipAgentConfigs?: boolean
  skipComponents?: boolean
  skipDataSources?: boolean
  skipApiSchemas?: boolean
  requestedProviderId?: ProviderId
  requestedModel?: string
  requestedEffort?: EffortLevel
}

const EMPTY_STATE: InitState = { running: false, steps: [] }

const open = ref(false)
const wizardStep = ref<WizardStep>('mode')
const initState = ref<InitState>(EMPTY_STATE)

// Editable copy of the server-provided draft. The user mutates these via the
// review-step UI; on commit we POST them back. We keep this separate from
// initState.draft so the WS rebroadcast doesn't clobber in-progress edits.
const draftSpec = ref<Record<string, any>>({})
const draftStyleGuide = ref('')
const overwriteStyleGuide = ref(false)
let draftHydrated = false

let wired = false
let designSpecRefetch: (() => Promise<void>) | null = null
let providerSettingsRef: ReturnType<typeof useProviderSettings> | null = null
// Module-level reference to the current designSpec value so openWizard can
// hydrate the draft without needing a prop.
let getDesignSpecValue: (() => Record<string, any> | null) | null = null

async function fetchInitState() {
  try {
    const res = await fetch('/__annotask/api/init/state')
    if (!res.ok) return
    initState.value = await res.json()
    hydrateDraftIfReady()
  } catch {
    /* offline — leave existing state */
  }
}

function hydrateDraftIfReady() {
  const draft = initState.value.draft
  if (draft && !draftHydrated) {
    draftSpec.value = JSON.parse(JSON.stringify(draft.spec))
    draftStyleGuide.value = draft.styleGuide
    overwriteStyleGuide.value = !draft.styleGuideExists
    draftHydrated = true
  }
}

async function hydrateFromCurrentSpec() {
  const spec = getDesignSpecValue?.()
  if (spec) {
    draftSpec.value = JSON.parse(JSON.stringify(spec))
    draftHydrated = true
  }
  // Also fetch the current style guide from disk.
  try {
    const res = await fetch('/__annotask/api/style-guide')
    if (res.ok) {
      const data = await res.json()
      draftStyleGuide.value = data.content ?? ''
      overwriteStyleGuide.value = false
    }
  } catch { /* offline */ }
}

async function startRun(opts: ScanOptions = {}) {
  draftHydrated = false
  try {
    const activeProvider = providerSettingsRef?.activeProvider.value
    const providerConfig = activeProvider ? providerSettingsRef?.settings.value.providers[activeProvider] : undefined
    const body = {
      ...opts,
      ...(activeProvider ? { requestedProviderId: activeProvider } : {}),
      ...(typeof providerConfig?.model === 'string' ? { requestedModel: providerConfig.model } : {}),
      ...(providerConfig?.effort ? { requestedEffort: providerConfig.effort } : {}),
    }
    const hasOpts = Object.values(body).some(Boolean)
    const res = await fetch('/__annotask/api/init/start', {
      method: 'POST',
      headers: hasOpts ? { 'Content-Type': 'application/json' } : undefined,
      body: hasOpts ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`Init start failed: ${res.status}`)
    initState.value = await res.json()
    wizardStep.value = 'scan'
  } catch (err) {
    initState.value = {
      ...initState.value,
      result: 'error',
      error: (err as Error).message,
      running: false,
    }
  }
}

async function cancelRun() {
  try {
    await fetch('/__annotask/api/init/cancel', { method: 'POST' })
  } catch {
    /* swallow — UI shows last broadcast */
  }
}

async function skipInit(): Promise<void> {
  try {
    await fetch('/__annotask/api/init/skip', { method: 'POST' })
    if (designSpecRefetch) await designSpecRefetch()
  } catch { /* swallow */ }
  // Close the wizard regardless — the server writes a placeholder spec marking
  // the project initialized, and the auto-open watcher won't reopen it.
  closeWizard()
}

async function commitDraft(): Promise<boolean> {
  try {
    const res = await fetch('/__annotask/api/init/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spec: draftSpec.value,
        styleGuide: draftStyleGuide.value,
        overwriteStyleGuide: overwriteStyleGuide.value,
      }),
    })
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: { message: res.statusText } }))
      throw new Error(errBody?.error?.message ?? `Commit failed: ${res.status}`)
    }
    initState.value = await res.json()
    if (designSpecRefetch) await designSpecRefetch()
    return true
  } catch (err) {
    initState.value = {
      ...initState.value,
      result: 'error',
      error: (err as Error).message,
    }
    return false
  }
}

// True when the wizard was reopened post-init for a targeted re-scan rather
// than a fresh setup. Drives Scan-step UX (default toggles off, hide
// post-run progress from the previous run, etc.).
const rescanMode = ref(false)

function openWizard(step?: WizardStep, opts: { rescan?: boolean } = {}) {
  rescanMode.value = !!opts.rescan
  // Default entry: 'mode' iff the user has never chosen a workflow; otherwise
  // 'agent'. Re-scans always land directly on 'agent'.
  if (!step) {
    const choice = providerSettingsRef?.settings.value.embeddedAgentEnabled
    step = choice == null ? 'mode' : 'agent'
  }
  wizardStep.value = step
  open.value = true
  // When jumping directly to review (e.g. already initialized), hydrate draft
  // from the current on-disk spec rather than waiting for a scan.
  if (wizardStep.value === 'review' && !draftHydrated) {
    hydrateFromCurrentSpec()
  }
}

function closeWizard() {
  open.value = false
  rescanMode.value = false
}

// Move to a specific step from inside the wizard. Mirrors openWizard's
// hydration logic so stepper-driven jumps to Review pull from disk if the
// in-memory draft hasn't been populated yet.
function goToStep(step: WizardStep) {
  wizardStep.value = step
  if (step === 'review' && !draftHydrated) {
    hydrateFromCurrentSpec()
  }
}

function nextStep() {
  if (wizardStep.value === 'mode') wizardStep.value = 'agent'
  else if (wizardStep.value === 'agent') wizardStep.value = 'scan'
  else if (wizardStep.value === 'scan') wizardStep.value = 'review'
  else if (wizardStep.value === 'review') {
    closeWizard()
    if (designSpecRefetch) designSpecRefetch()
  }
}

// ── Draft editors ─────────────────────────────────────
// Lightweight mutators that keep draftSpec immutably-replaced so Vue's
// reactivity picks them up.

interface ThemeEntry {
  id: string
  name: string
  scheme?: string
  selector: Record<string, any>
}

function getThemes(): ThemeEntry[] {
  const t = draftSpec.value.themes
  return Array.isArray(t) ? (t as ThemeEntry[]) : []
}

function setThemes(next: ThemeEntry[]) {
  draftSpec.value = { ...draftSpec.value, themes: next }
}

function addTheme() {
  const themes = getThemes()
  let id = 'new-theme'
  let n = 1
  const existing = new Set(themes.map(t => t.id))
  while (existing.has(id)) { n++; id = `new-theme-${n}` }
  setThemes([...themes, { id, name: 'New theme', selector: { kind: 'class', host: 'html', name: id } }])
}

function updateTheme(index: number, patch: Partial<ThemeEntry>) {
  const themes = getThemes()
  if (index < 0 || index >= themes.length) return
  const next = [...themes]
  next[index] = { ...next[index], ...patch }
  setThemes(next)
}

function updateThemeSelector(index: number, patch: Record<string, any>) {
  const themes = getThemes()
  if (index < 0 || index >= themes.length) return
  const next = [...themes]
  next[index] = { ...next[index], selector: { ...next[index].selector, ...patch } }
  setThemes(next)
}

function removeTheme(index: number) {
  const themes = getThemes()
  if (index < 0 || index >= themes.length) return
  const removedId = themes[index].id
  const next = themes.filter((_, i) => i !== index)
  setThemes(next)
  if (draftSpec.value.defaultTheme === removedId) {
    draftSpec.value = { ...draftSpec.value, defaultTheme: next[0]?.id ?? 'default' }
  }
}

function setDefaultTheme(id: string) {
  draftSpec.value = { ...draftSpec.value, defaultTheme: id }
}

function updateFramework(patch: Record<string, any>) {
  const fw = draftSpec.value.framework ?? { name: 'unknown', version: '', styling: [] }
  draftSpec.value = { ...draftSpec.value, framework: { ...fw, ...patch } }
}

function setStyleGuide(text: string) {
  draftStyleGuide.value = text
}

function setOverwriteStyleGuide(v: boolean) {
  overwriteStyleGuide.value = v
}

export function useInitFlow() {
  const designSpec = useDesignSpec()
  designSpecRefetch = designSpec.refetch
  const providerSettings = useProviderSettings()
  providerSettingsRef = providerSettings

  if (!wired) {
    wired = true

    // Server pushes a fresh state on every step change.
    let lastWsPushAt = 0
    wsOn('init:progress', (data) => {
      if (data && typeof data === 'object') {
        lastWsPushAt = Date.now()
        initState.value = data as InitState
        hydrateDraftIfReady()
      }
    })

    fetchInitState()

    // Poll fallback. The WS push is the primary update channel, but if the
    // dev server restarts mid-run (OOM, container recreate, …) the socket
    // dies silently and the wizard's "Running…" spinner ticks forever
    // because no fresh state ever arrives. While a run is in flight, poll
    // every 3s; skip the poll if the WS pushed within the last 2s so we
    // don't double-fetch during a healthy run.
    setInterval(() => {
      if (!initState.value.running) return
      if (Date.now() - lastWsPushAt < 2_000) return
      fetchInitState()
    }, 3_000)
    getDesignSpecValue = () => designSpec.designSpec.value as Record<string, any> | null

    // Auto-open rules + deferred migration of pre-`embeddedAgentEnabled`
    // settings:
    //   - !initialized + null     → open Page 0 (workflow choice forced
    //                                even if stale `agentMode` from an old
    //                                install would otherwise have implied one)
    //   - !initialized + true     → open at 'agent' (provider setup)
    //   - !initialized + false    → no auto-open (skill mode)
    //   - initialized  + null     → silently migrate from legacy `agentMode`
    //                                (auto/manual → true, off → false) and
    //                                do not re-prompt — these users were
    //                                already using Annotask successfully.
    //   - initialized  + anything → no auto-open.
    watch(
      () => [
        designSpec.isLoading.value,
        designSpec.isInitialized.value,
        providerSettings.settings.value.embeddedAgentEnabled,
      ] as const,
      ([loading, initialized, embeddedChoice]) => {
        if (loading) return
        // Still advance scan→review for an in-flight wizard regardless of state.
        if (open.value && wizardStep.value === 'scan' && initState.value.result === 'awaiting_review') {
          wizardStep.value = 'review'
        }
        if (open.value) return
        if (embeddedChoice == null) {
          if (initialized) {
            // Existing user upgrading — derive their preference from the
            // pre-existing `agentMode` and skip Page 0.
            const mode = providerSettings.settings.value.agentMode
            providerSettings.setEmbeddedAgentEnabled(mode !== 'off')
            return
          }
          openWizard('mode')
          return
        }
        if (embeddedChoice === true && !initialized) {
          openWizard('agent')
        }
      },
      { immediate: true },
    )

    // When the scan finishes with `awaiting_review`, advance the wizard to
    // the review step so the user sees the draft right away.
    watch(
      () => initState.value.result,
      (result) => {
        if (result === 'awaiting_review' && wizardStep.value === 'scan') {
          wizardStep.value = 'review'
        }
        if (result === 'success' && initState.value.committedAt != null) {
          designSpec.refetch()
        }
      },
    )
  }

  const hasConfiguredProvider = computed(() => {
    const active = providerSettings.activeProvider.value
    return Boolean(active)
  })

  const overallProgress = computed(() => {
    const steps = initState.value.steps
    if (steps.length === 0) return 0
    const done = steps.filter(s => s.status === 'success' || s.status === 'skipped').length
    return Math.round((done / steps.length) * 100)
  })

  return {
    open,
    wizardStep,
    rescanMode,
    initState,
    overallProgress,
    hasConfiguredProvider,
    isInitialized: designSpec.isInitialized,
    openWizard,
    closeWizard,
    nextStep,
    goToStep,
    startRun,
    cancelRun,
    skipInit,
    commitDraft,
    // Draft state + mutators
    draftSpec,
    draftStyleGuide,
    overwriteStyleGuide,
    addTheme,
    updateTheme,
    updateThemeSelector,
    removeTheme,
    setDefaultTheme,
    updateFramework,
    setStyleGuide,
    setOverwriteStyleGuide,
  }
}
