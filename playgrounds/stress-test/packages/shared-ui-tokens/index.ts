// Side-effect-free re-export — consumers do one of:
//   import '@annotask/stress-ui-tokens/tokens.css'
//   import { TOKEN_NAMES, applyTheme, getTheme, onThemeChange } from '@annotask/stress-ui-tokens'
//
// The CSS file carries the actual cascading tokens; this TS file is
// useful for tooling that wants to enumerate the token names and for
// MFEs that need to react to theme changes (e.g. Mantine / Naive UI /
// Radix Themes, which have their own colour-scheme providers).

export const TOKEN_NAMES = [
  'stress-bg',
  'stress-surface',
  'stress-surface-2',
  'stress-surface-3',
  'stress-border',
  'stress-border-strong',
  'stress-text',
  'stress-text-muted',
  'stress-text-subtle',
  'stress-text-on-accent',
  'stress-accent',
  'stress-accent-hover',
  'stress-accent-subtle',
  'stress-accent-subtle-text',
  'stress-focus-ring',
  'stress-success',
  'stress-warning',
  'stress-danger',
  'stress-info',
  'stress-sidebar-bg',
  'stress-sidebar-surface',
  'stress-sidebar-surface-2',
  'stress-sidebar-border',
  'stress-sidebar-text',
  'stress-sidebar-text-muted',
  'stress-sidebar-accent',
  'stress-sidebar-accent-text',
  'stress-radius',
  'stress-radius-sm',
  'stress-radius-pill',
  'stress-gutter',
  'stress-sidebar-width',
  'stress-shadow-sm',
  'stress-shadow-md',
  'stress-font',
  'stress-font-mono',
] as const

export type TokenName = (typeof TOKEN_NAMES)[number]

export type StressTheme = 'light' | 'dark'

const STORAGE_KEY = 'stress-lab:theme'
const EVENT_NAME = 'stress-theme-change'

export function getTheme(): StressTheme {
  if (typeof document === 'undefined') return 'light'
  const attr = document.documentElement.dataset.theme
  if (attr === 'dark' || attr === 'light') return attr
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // localStorage unavailable — fall through
  }
  return 'light'
}

export function applyTheme(theme: StressTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent<StressTheme>(EVENT_NAME, { detail: theme }))
}

export function onThemeChange(cb: (theme: StressTheme) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (ev: Event) => {
    const theme = (ev as CustomEvent<StressTheme>).detail
    if (theme === 'dark' || theme === 'light') cb(theme)
  }
  window.addEventListener(EVENT_NAME, handler as EventListener)
  return () => window.removeEventListener(EVENT_NAME, handler as EventListener)
}

// Bootstrap: restore the stored theme onto <html> as early as the
// consumer imports this module. Safe to call multiple times.
export function bootstrapTheme(): StressTheme {
  const theme = getTheme()
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme
  }
  return theme
}
