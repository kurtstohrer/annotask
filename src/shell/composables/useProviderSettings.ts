import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import {
  DEFAULT_PROVIDER_SETTINGS,
  parseProviderSettings,
  isActiveProviderReady,
  type ProviderId,
  type ProviderSettings,
  type ProviderConfig,
  PROVIDER_IDS,
} from '../../embedded/provider-config.js'
import {
  BudgetCap,
  pricerFromRateCard,
  type BudgetPricer,
  type BudgetSnapshot,
} from '../../embedded/budget-cap.js'
import { EventLog, type PersistenceSink } from '../../embedded/event-log.js'
import { ANTHROPIC_PRICING, DEFAULT_MODEL as DEFAULT_ANTHROPIC_MODEL } from '../services/embeddedAgent/pricing'

/**
 * Multi-provider settings for the embedded chat. This is the M4 data layer
 * that the redesigned settings sheet binds to and that the runner reads
 * before each provider call. Singleton because the gear-icon sheet, the
 * composer cap chip, and the cost meter all read from the same source.
 *
 * Storage posture: localStorage only, behind a single key. Keys never
 * leave the browser — same posture as `useAIConfig`.
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

function create(persistence: PersistenceShim = makeLocalStorageShim()) {
  const initial = parseProviderSettings(persistence.load())
  const settings: Ref<ProviderSettings> = ref(initial)

  watch(
    settings,
    (next) => {
      persistence.save(next)
    },
    { deep: true },
  )

  const activeProvider: ComputedRef<ProviderId> = computed(() => settings.value.activeProvider)

  const ready = computed(() => isActiveProviderReady(settings.value))

  const eventLog = new EventLog({
    persistence: makeLocalStoragePersistenceSink(),
    persistenceKey: 'annotask:ai:eventLog',
  })

  function setActiveProvider(id: ProviderId) {
    settings.value = { ...settings.value, activeProvider: id }
  }

  function setProviderConfig<C extends ProviderConfig>(config: C) {
    settings.value = {
      ...settings.value,
      providers: { ...settings.value.providers, [config.id]: config },
    }
  }

  function setCap(usd: number) {
    if (!Number.isFinite(usd) || usd <= 0) return
    settings.value = { ...settings.value, perConversationCapUsd: usd }
  }

  function setRedactionEnabled(on: boolean) {
    settings.value = { ...settings.value, redactionEnabled: on }
  }

  function setEventLogEnabled(on: boolean) {
    settings.value = { ...settings.value, eventLogEnabled: on }
  }

  /**
   * Pricer for the *currently active* provider+model. Falls back to the
   * Anthropic rate card for models we don't recognize so the cap still
   * does something useful before per-provider rate cards land.
   */
  function pricerForActive(): BudgetPricer {
    const active = settings.value.providers[settings.value.activeProvider]
    const modelId = active.model || DEFAULT_ANTHROPIC_MODEL
    const known = (ANTHROPIC_PRICING as Record<string, { inputPerMTok: number; outputPerMTok: number }>)[modelId]
    if (known) {
      return pricerFromRateCard({
        inputPerMTok: known.inputPerMTok,
        outputPerMTok: known.outputPerMTok,
      })
    }
    const fallback = ANTHROPIC_PRICING[DEFAULT_ANTHROPIC_MODEL]
    return pricerFromRateCard({
      inputPerMTok: fallback.inputPerMTok,
      outputPerMTok: fallback.outputPerMTok,
    })
  }

  /**
   * Construct a fresh BudgetCap for a new conversation. Each conversation
   * should have its own instance so caps are per-conversation, not
   * per-session.
   */
  function makeConversationBudget(): BudgetCap {
    return new BudgetCap({
      capUsd: settings.value.perConversationCapUsd,
      pricer: pricerForActive(),
    })
  }

  /**
   * Helper for the composer's token meter. Sums all `turn` events for the
   * given conversation id straight from the local event log.
   */
  function usageForConversation(conversationId: string): BudgetSnapshot {
    const cap = makeConversationBudget()
    const totals = eventLog.totalsByConversation(conversationId)
    cap.accumulate({
      input: totals.inputTokens,
      output: totals.outputTokens,
      cacheRead: totals.cacheReadTokens,
      cacheWrite: totals.cacheCreationTokens,
    })
    return cap.snapshot()
  }

  return {
    settings,
    activeProvider,
    ready,
    providerIds: PROVIDER_IDS,
    setActiveProvider,
    setProviderConfig,
    setCap,
    setRedactionEnabled,
    setEventLogEnabled,
    pricerForActive,
    makeConversationBudget,
    usageForConversation,
    eventLog,
  }
}

export type UseProviderSettings = ReturnType<typeof create>

export function useProviderSettings(): UseProviderSettings {
  if (!singleton) singleton = create()
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
  ANTHROPIC_PRICING,
  DEFAULT_PROVIDER_SETTINGS,
  PROVIDER_IDS,
}
export type { ProviderId, ProviderSettings, ProviderConfig }
