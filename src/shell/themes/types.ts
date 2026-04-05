/** All CSS custom property values that define an Annotask shell theme. */
export interface ShellThemeColors {
  // ── Surfaces ──
  bg: string
  surface: string
  'surface-2': string
  'surface-3': string
  'surface-elevated': string
  'surface-glass': string
  'surface-overlay': string

  // ── Borders ──
  border: string
  'border-strong': string

  // ── Text ──
  text: string
  'text-muted': string
  'text-on-accent': string
  'text-inverse': string
  'text-link': string

  // ── Accent ──
  accent: string
  'accent-hover': string
  'accent-muted': string

  // ── Semantic ──
  danger: string
  success: string
  warning: string
  info: string
  'focus-ring': string

  // ── Extended palette ──
  purple: string
  orange: string
  cyan: string
  indigo: string

  // ── Utility ──
  overlay: string
  shadow: string

  // ── Status (task lifecycle) ──
  'status-pending': string
  'status-in-progress': string
  'status-review': string
  'status-denied': string
  'status-accepted': string
  'status-needs-info': string
  'status-blocked': string

  // ── Severity (a11y / perf) ──
  'severity-critical': string
  'severity-serious': string
  'severity-moderate': string
  'severity-minor': string

  // ── Interaction modes ──
  'mode-interact': string
  'mode-arrow': string
  'mode-draw': string
  'mode-highlight': string

  // ── Layout visualization ──
  'layout-flex': string
  'layout-grid': string

  // ── Element roles ──
  'role-container': string
  'role-content': string
  'role-component': string

  // ── Syntax highlighting ──
  'syntax-property': string
  'syntax-string': string
  'syntax-number': string
  'syntax-boolean': string
  'syntax-null': string
  'syntax-operator': string
  'syntax-punctuation': string

  // ── Tool overlays ──
  'pin-color': string
  'highlight-color': string

  // ── Annotation presets ──
  'annotation-red': string
  'annotation-orange': string
  'annotation-yellow': string
  'annotation-green': string
  'annotation-blue': string
  'annotation-purple': string
}

export type ShellThemeGroup = 'default' | 'high-contrast' | 'accessibility' | 'editor' | 'custom'

export interface ShellTheme {
  id: string
  name: string
  type: 'dark' | 'light'
  group: ShellThemeGroup
  description?: string
  isCustom?: boolean
  colors: ShellThemeColors
}

/** All CSS variable keys in ShellThemeColors. */
export const THEME_COLOR_KEYS: (keyof ShellThemeColors)[] = [
  'bg', 'surface', 'surface-2', 'surface-3', 'surface-elevated', 'surface-glass', 'surface-overlay',
  'border', 'border-strong',
  'text', 'text-muted', 'text-on-accent', 'text-inverse', 'text-link',
  'accent', 'accent-hover', 'accent-muted',
  'danger', 'success', 'warning', 'info', 'focus-ring',
  'purple', 'orange', 'cyan', 'indigo',
  'overlay', 'shadow',
  'status-pending', 'status-in-progress', 'status-review', 'status-denied',
  'status-accepted', 'status-needs-info', 'status-blocked',
  'severity-critical', 'severity-serious', 'severity-moderate', 'severity-minor',
  'mode-interact', 'mode-arrow', 'mode-draw', 'mode-highlight',
  'layout-flex', 'layout-grid',
  'role-container', 'role-content', 'role-component',
  'syntax-property', 'syntax-string', 'syntax-number', 'syntax-boolean',
  'syntax-null', 'syntax-operator', 'syntax-punctuation',
  'pin-color', 'highlight-color',
  'annotation-red', 'annotation-orange', 'annotation-yellow',
  'annotation-green', 'annotation-blue', 'annotation-purple',
]
