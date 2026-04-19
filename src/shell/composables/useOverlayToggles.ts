import { ref } from 'vue'

/**
 * Mutually-exclusive overlay toggles (shortcuts / settings).
 * Opening one closes the other.
 */
export function useOverlayToggles() {
  const showShortcuts = ref(false)
  const showSettings = ref(false)

  function toggleShortcuts() {
    showShortcuts.value = !showShortcuts.value
    if (showShortcuts.value) {
      showSettings.value = false
    }
  }

  function toggleSettings() {
    showSettings.value = !showSettings.value
    if (showSettings.value) {
      showShortcuts.value = false
    }
  }

  return {
    showShortcuts,
    showSettings,
    toggleShortcuts,
    toggleSettings,
  }
}
