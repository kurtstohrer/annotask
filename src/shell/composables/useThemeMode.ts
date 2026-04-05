import { computed } from 'vue'
import { useShellTheme } from './useShellTheme'

export type ThemeMode = 'light' | 'dark' | 'system'

/**
 * @deprecated Use `useShellTheme()` instead. This wrapper exists for backward
 * compatibility and will be removed in a future release.
 */
export function useThemeMode() {
  const theme = useShellTheme()

  const mode = computed<ThemeMode>({
    get() {
      const id = theme.activeThemeId.value
      if (id === 'system') return 'system'
      if (id === 'light') return 'light'
      return 'dark'
    },
    set(m: ThemeMode) {
      theme.setTheme(m === 'system' ? 'system' : m === 'light' ? 'light' : 'dark')
    },
  })

  const resolved = computed(() => theme.resolvedType.value)

  function toggle() {
    if (mode.value === 'system') mode.value = 'light'
    else if (mode.value === 'light') mode.value = 'dark'
    else mode.value = 'system'
  }

  function setMode(m: ThemeMode) {
    mode.value = m
  }

  return { mode, resolved, toggle, setMode }
}
