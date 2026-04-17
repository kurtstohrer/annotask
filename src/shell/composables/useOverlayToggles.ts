import { ref } from 'vue'

/**
 * Mutually-exclusive overlay toggles (shortcuts / context / settings).
 * Opening one closes the others.
 */
export function useOverlayToggles() {
  const showShortcuts = ref(false)
  const showContext = ref(false)
  const showSettings = ref(false)

  function toggleShortcuts() {
    showShortcuts.value = !showShortcuts.value
    if (showShortcuts.value) {
      showContext.value = false
      showSettings.value = false
    }
  }

  function toggleContext() {
    showContext.value = !showContext.value
    if (showContext.value) {
      showShortcuts.value = false
      showSettings.value = false
    }
  }

  function toggleSettings() {
    showSettings.value = !showSettings.value
    if (showSettings.value) {
      showShortcuts.value = false
      showContext.value = false
    }
  }

  return {
    showShortcuts,
    showContext,
    showSettings,
    toggleShortcuts,
    toggleContext,
    toggleSettings,
  }
}
