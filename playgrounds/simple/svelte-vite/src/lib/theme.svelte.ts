/**
 * Theme store — light/dark, persisted to localStorage,
 * applied via data-theme attribute on <html>.
 */

const STORAGE_KEY = 'atlas-theme'

type Theme = 'dark' | 'light'

function load(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function apply(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* noop */
  }
}

export function createThemeStore() {
  let theme = $state<Theme>(load())
  apply(theme)

  return {
    get value() {
      return theme
    },
    toggle() {
      theme = theme === 'dark' ? 'light' : 'dark'
      apply(theme)
    },
  }
}
