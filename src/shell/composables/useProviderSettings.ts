import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import {
  DEFAULT_PROVIDER_SETTINGS,
  parseProviderSettings,
  isActiveProviderReady,
  type AgentMode,
  type EffortLevel,
  type LocalCliReadiness,
  type ProviderId,
  type ProviderSettings,
  type ProviderConfig,
  PROVIDER_IDS,
} from '../../embedded/provider-config.js'
import type { PermissionMode } from '../../schema.js'
import {
  combinePersonas,
  resolvePersonaForTaskType,
  type PersonaConfig,
  type PersonaRuntimeOverride,
} from '../../embedded/persona.js'
import { EventLog, type PersistenceSink } from '../../embedded/event-log.js'
import { useAgentConfigs } from './useAgentConfigs.js'

/**
 * Multi-provider settings for the embedded chat. Singleton because the
 * settings sheet, the Conversation tab header, the first-run modal, and
 * the task-creation auto-run hook all read from the same source.
 *
 * Storage posture: localStorage only, behind a single key. Keys never
 * leave the browser.
 *
 * Per-task USD cost caps were removed: heterogeneous providers (local
 * CLIs, OpenRouter, Paperclip, …) have no portable pricing surface, so a
 * dollar-denominated cap can't be meaningful across the matrix. Token
 * counts come back from each provider when they support it and the UI
 * surfaces them informationally.
 */

const STORAGE_KEY = 'annotask:ai:providerSettings'

let singleton: ReturnType<typeof create> | null = null

interface PersistenceShim {
  load(): unknown
  save(value: unknown): void
}

function makeLocalStorageShim(): PersistenceShim {
  return {
    load: () => {
      try {
        return localStorage.getItem(STORAGE_KEY)
      } catch {
        return null
      }
    },
    save: (value) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch {
        // Quota errors are best-effort; the user can re-enter on next reload.
      }
    },
  }
}

function makeLocalStoragePersistenceSink(): PersistenceSink | undefined {
  if (typeof localStorage === 'undefined') return undefined
  return localStorage
}

/** Accessor for per-agent overrides sourced from `.annotask/agents.json`.
 *  Returns a snapshot map keyed by persona id; called from the `personas`
 *  computed so it must be reactive on each read (Vue's tracking handles this
 *  as long as it touches a reactive ref). */
type AgentOverridesAccessor = () => Record<string, PersonaRuntimeOverride>

function create(
  persistence: PersistenceShim = makeLocalStorageShim(),
  agentOverrides: AgentOverridesAccessor = () => ({}),
) {
  const initial = parseProviderSettings(persistence.load())
  const settings: Ref<ProviderSettings> = ref(initial)

  watch(
    settings,
    (next) => {
      persistence.save(next)
    },
    { deep: true },
  )

  /**
   * Local-CLI probe. The settings panel writes to this with whatever
   * `/__annotask/api/agent/detect` reports; the readiness computation
   * reads it so local-CLI providers can be marked ready or not without
   * baking the probe into provider-config itself.
   */
  const localCliProbe = ref<LocalCliReadiness>({})

  const activeProvider: ComputedRef<ProviderId> = computed(() => settings.value.activeProvider)

  const ready = computed(() => isActiveProviderReady(settings.value, localCliProbe.value))

  const eventLog = new EventLog({
    persistence: makeLocalStoragePersistenceSink(),
    persistenceKey: 'annotask:ai:eventLog',
  })

  function setLocalCliProbe(probe: LocalCliReadiness) {
    localCliProbe.value = probe
  }

  function setActiveProvider(id: ProviderId) {
    settings.value = { ...settings.value, activeProvider: id }
  }

  function setProviderConfig<C extends ProviderConfig>(config: C) {
    settings.value = {
      ...settings.value,
      providers: { ...settings.value.providers, [config.id]: config },
    }
  }

  /** Update the effort knob for the named provider in-place. */
  function setEffort(id: ProviderId, effort: EffortLevel) {
    const current = settings.value.providers[id]
    setProviderConfig({ ...current, effort } as ProviderConfig)
  }

  /** Update the model id for the named provider in-place. Empty = auto. */
  function setModel(id: ProviderId, model: string) {
    const current = settings.value.providers[id]
    setProviderConfig({ ...current, model } as ProviderConfig)
  }

  function setAgentMode(mode: AgentMode) {
    settings.value = { ...settings.value, agentMode: mode }
  }

  /**
   * Top-level embedded-agent toggle. Set to `true` to enable the in-shell
   * Conversation tab / auto-run / provider setup; `false` puts the user in
   * skill/MCP mode (classic UI, no spawned subprocess, MCP server still up).
   * When switching from off→on for the first time we also ensure `agentMode`
   * is non-`'off'` so the user actually sees the agent running.
   */
  function setEmbeddedAgentEnabled(value: boolean) {
    const next: ProviderSettings = { ...settings.value, embeddedAgentEnabled: value }
    if (value && next.agentMode === 'off') next.agentMode = 'auto'
    settings.value = next
  }

  function setPermissionMode(mode: PermissionMode) {
    settings.value = { ...settings.value, permissionMode: mode }
  }

  /**
   * Per-provider permission-mode override. Passing `null` clears the override
   * so the provider inherits the global setting. Only local-CLI providers
   * carry the field — calling this with an HTTP provider id is a no-op.
   */
  function setProviderPermissionMode(id: ProviderId, mode: PermissionMode | null) {
    const current = settings.value.providers[id]
    if (!('permissionMode' in current) && mode === null) return
    if (id !== 'claude-local' && id !== 'codex-local' && id !== 'opencode-local' && id !== 'copilot-local') return
    const next = { ...current, permissionMode: mode ?? undefined } as ProviderConfig
    setProviderConfig(next)
  }

  function setOnboardingDismissed(dismissed = true) {
    settings.value = { ...settings.value, onboardingDismissed: dismissed }
  }

  function setRedactionEnabled(on: boolean) {
    settings.value = { ...settings.value, redactionEnabled: on }
  }

  function setEventLogEnabled(on: boolean) {
    settings.value = { ...settings.value, eventLogEnabled: on }
  }

  /** Run-safety watchdog knobs. Stored in ms; `0` disables that timer. */
  function setIdleTimeoutMs(ms: number) {
    settings.value = { ...settings.value, idleTimeoutMs: Math.max(0, Math.floor(ms)) }
  }

  function setMaxRunDurationMs(ms: number) {
    settings.value = { ...settings.value, maxRunDurationMs: Math.max(0, Math.floor(ms)) }
  }

  // ── Personas ─────────────────────────────────────────
  //
  // Built-ins are merged in at read time so the UI never shows a stale
  // snapshot when persona.ts is updated in a new annotask release.

  const personas: ComputedRef<PersonaConfig[]> = computed(() =>
    combinePersonas(settings.value.customPersonas ?? [], agentOverrides()),
  )

  function getPersonaForTaskType(taskType: string | undefined): PersonaConfig | null {
    return resolvePersonaForTaskType(personas.value, taskType, settings.value.personaOverrides ?? {})
  }

  /** Insert or replace a custom persona by id. Built-ins are never written
   *  to `customPersonas`; instead, editing a built-in clones it as
   *  `custom:<built-in-id>` so the original stays available. */
  function upsertPersona(persona: PersonaConfig) {
    const existing = settings.value.customPersonas ?? []
    const idx = existing.findIndex(p => p.id === persona.id)
    const next = persona.isCustom ? persona : { ...persona, isCustom: true }
    const updated = idx >= 0
      ? existing.map((p, i) => i === idx ? next : p)
      : [...existing, next]
    settings.value = { ...settings.value, customPersonas: updated }
  }

  function deletePersona(id: string) {
    const existing = settings.value.customPersonas ?? []
    const updated = existing.filter(p => p.id !== id)
    // Also drop any override pinning a task type to this persona.
    const overrides = { ...(settings.value.personaOverrides ?? {}) }
    for (const k of Object.keys(overrides)) {
      if (overrides[k] === id) delete overrides[k]
    }
    settings.value = { ...settings.value, customPersonas: updated, personaOverrides: overrides }
  }

  function setPersonaOverride(taskType: string, personaId: string | null) {
    const overrides = { ...(settings.value.personaOverrides ?? {}) }
    if (personaId == null || personaId === '') {
      delete overrides[taskType]
    } else {
      overrides[taskType] = personaId
    }
    settings.value = { ...settings.value, personaOverrides: overrides }
  }

  return {
    settings,
    activeProvider,
    ready,
    providerIds: PROVIDER_IDS,
    localCliProbe,
    setLocalCliProbe,
    setActiveProvider,
    setProviderConfig,
    setEffort,
    setModel,
    setAgentMode,
    setEmbeddedAgentEnabled,
    setPermissionMode,
    setProviderPermissionMode,
    setOnboardingDismissed,
    setRedactionEnabled,
    setEventLogEnabled,
    setIdleTimeoutMs,
    setMaxRunDurationMs,
    personas,
    getPersonaForTaskType,
    upsertPersona,
    deletePersona,
    setPersonaOverride,
    eventLog,
  }
}

export type UseProviderSettings = ReturnType<typeof create>

export function useProviderSettings(): UseProviderSettings {
  if (!singleton) {
    // Wire in per-agent overrides from `.annotask/agents.json` so the
    // persona resolver picks up project-specific provider/model/effort
    // without each consumer having to know about agent-configs.
    singleton = create(makeLocalStorageShim(), () => {
      const cfg = useAgentConfigs().configs.value
      const out: Record<string, PersonaRuntimeOverride> = {}
      for (const [id, entry] of Object.entries(cfg)) {
        const o: PersonaRuntimeOverride = {}
        if (entry.providerId) o.providerId = entry.providerId
        if (typeof entry.model === 'string') o.model = entry.model
        if (entry.effort) o.effort = entry.effort
        if (Object.keys(o).length > 0) out[id] = o
      }
      return out
    })
  }
  return singleton
}

/**
 * Reset the singleton. Test-only — production callers should never need
 * this.
 */
export function resetProviderSettingsForTests(): void {
  singleton = null
}

/**
 * Construct a non-singleton instance with an explicit persistence shim.
 * Used by tests so they don't share state through the module-level
 * singleton.
 */
export function createProviderSettingsForTests(initial: unknown = null) {
  let stored = initial
  return create({
    load: () => stored,
    save: (v) => {
      stored = JSON.stringify(v)
    },
  })
}

// Re-exports so the panel can import everything from one place.
export {
  DEFAULT_PROVIDER_SETTINGS,
  PROVIDER_IDS,
}
export type { AgentMode, EffortLevel, ProviderId, ProviderSettings, ProviderConfig }
export type { PermissionMode } from '../../schema.js'
