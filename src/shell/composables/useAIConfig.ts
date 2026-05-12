import { ref, computed, watch } from 'vue'
import { useLocalStorageRef, useLocalStorageBool, useLocalStorageEnum } from './useLocalStorageRef'
import { ANTHROPIC_PRICING, DEFAULT_MODEL } from '../services/embeddedAgent/pricing'

/**
 * BYOK + cost-cap settings for the embedded agent.
 *
 * Storage posture matches the rest of the shell (localStorage, same key
 * prefix as dev-server config). The key never leaves the browser — no
 * request to any Annotask server carries it.
 */

const KEY_API_KEY = 'annotask:ai:anthropicKey'
const KEY_MODEL = 'annotask:ai:model'
const KEY_CAP_USD = 'annotask:ai:capUsd'
const KEY_SILENT_MODE = 'annotask:ai:silentMode'

const DEFAULT_CAP_USD = '0.50'

const modelIds = Object.keys(ANTHROPIC_PRICING) as Array<keyof typeof ANTHROPIC_PRICING>

let singleton: ReturnType<typeof create> | null = null

function create() {
  const apiKey = useLocalStorageRef(KEY_API_KEY, '')
  const model = useLocalStorageEnum(KEY_MODEL, modelIds, DEFAULT_MODEL as typeof modelIds[number])
  const capUsdRaw = useLocalStorageRef(KEY_CAP_USD, DEFAULT_CAP_USD)
  const silentMode = useLocalStorageBool(KEY_SILENT_MODE, false)

  const validationState = ref<'idle' | 'validating' | 'ok' | 'invalid' | 'error'>('idle')
  const validationMessage = ref('')

  const hasKey = computed(() => apiKey.value.trim().length > 0)
  const capUsd = computed(() => {
    const n = Number.parseFloat(capUsdRaw.value)
    return Number.isFinite(n) && n > 0 ? n : Number.parseFloat(DEFAULT_CAP_USD)
  })

  watch(apiKey, () => {
    // A key change invalidates any prior validation result.
    if (validationState.value !== 'idle') {
      validationState.value = 'idle'
      validationMessage.value = ''
    }
  })

  /**
   * Validate the key against the Anthropic Models endpoint. This is a real
   * network call, but with no message tokens it costs nothing — Anthropic
   * doesn't bill for `/v1/models`. We're using it purely for credential
   * verification.
   */
  async function validate(): Promise<void> {
    if (!apiKey.value.trim()) {
      validationState.value = 'invalid'
      validationMessage.value = 'Paste a key first.'
      return
    }
    validationState.value = 'validating'
    validationMessage.value = ''
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          'x-api-key': apiKey.value.trim(),
          'anthropic-version': '2023-06-01',
        },
      })
      if (res.ok) {
        validationState.value = 'ok'
        validationMessage.value = 'Key verified.'
        return
      }
      if (res.status === 401 || res.status === 403) {
        validationState.value = 'invalid'
        validationMessage.value = 'Anthropic rejected this key.'
        return
      }
      validationState.value = 'error'
      validationMessage.value = `Unexpected status ${res.status}.`
    } catch (err) {
      validationState.value = 'error'
      validationMessage.value = (err as Error)?.message ?? 'Network error.'
    }
  }

  function clearKey() {
    apiKey.value = ''
    validationState.value = 'idle'
    validationMessage.value = ''
  }

  return {
    apiKey,
    model,
    capUsdRaw,
    capUsd,
    silentMode,
    hasKey,
    validationState,
    validationMessage,
    validate,
    clearKey,
    availableModels: modelIds,
  }
}

export function useAIConfig() {
  if (!singleton) singleton = create()
  return singleton
}
