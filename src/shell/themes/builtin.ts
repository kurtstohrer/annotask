import type { ShellTheme, ShellThemeColors, ShellThemeGroup } from './types'

/**
 * Core colors that a theme must define. The rest are derived automatically
 * but can be overridden in the `overrides` parameter.
 */
interface ThemeCoreColors {
  bg: string
  surface: string
  'surface-2': string
  'surface-3': string
  'surface-elevated': string
  'surface-glass': string
  'surface-overlay': string
  border: string
  'border-strong': string
  text: string
  'text-muted': string
  'text-on-accent': string
  'text-inverse': string
  'text-link': string
  accent: string
  'accent-hover': string
  'accent-muted': string
  danger: string
  success: string
  warning: string
  info: string
  'focus-ring': string
  purple: string
  orange: string
  cyan: string
  indigo: string
  overlay: string
  shadow: string
}

/** Derive all 60 theme colors from core colors + optional overrides. */
function deriveDefaults(core: ThemeCoreColors, overrides?: Partial<ShellThemeColors>): ShellThemeColors {
  const defaults: ShellThemeColors = {
    ...core,

    // Status — default to semantic colors
    'status-pending': core['text-muted'],
    'status-in-progress': core.accent,
    'status-review': core.warning,
    'status-denied': core.danger,
    'status-accepted': core.success,
    'status-needs-info': core.purple,
    'status-blocked': core.orange,

    // Severity — default to semantic colors
    'severity-critical': core.danger,
    'severity-serious': core.danger,
    'severity-moderate': core.warning,
    'severity-minor': core['text-muted'],

    // Modes — arrow and highlight are fixed across all themes for consistency
    'mode-interact': core.indigo,
    'mode-arrow': '#ef4444',
    'mode-draw': core['text-muted'],
    'mode-highlight': '#f59e0b',

    // Layout viz
    'layout-flex': core.purple,
    'layout-grid': core.success,

    // Roles
    'role-container': core.success,
    'role-content': core.accent,
    'role-component': core.purple,

    // Syntax highlighting — sensible defaults per theme type
    'syntax-property': core.cyan,
    'syntax-string': core.success,
    'syntax-number': core.warning,
    'syntax-boolean': core.purple,
    'syntax-null': core.danger,
    'syntax-operator': core['text-muted'],
    'syntax-punctuation': core['text-muted'],

    // Tool overlays
    'pin-color': '#3b82f6',
    'highlight-color': core.accent,

    // Annotation presets — must be 6 visually distinct colors within each theme
    'annotation-red': '#ef4444',
    'annotation-orange': '#f97316',
    'annotation-yellow': '#eab308',
    'annotation-green': '#22c55e',
    'annotation-blue': '#3b82f6',
    'annotation-purple': '#8b5cf6',
  }

  // Apply any explicit overrides
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) (defaults as unknown as Record<string, string>)[k] = v
    }
  }

  return defaults
}

function theme(
  id: string,
  name: string,
  type: 'dark' | 'light',
  group: ShellThemeGroup,
  description: string,
  core: ThemeCoreColors,
  overrides?: Partial<ShellThemeColors>,
): ShellTheme {
  return { id, name, type, group, description, colors: deriveDefaults(core, overrides) }
}

// ─── Built-in Themes ────────────────────────────────────────────────────────

const dark = theme('dark', 'Dark', 'dark', 'default', 'Default dark theme', {
  bg: '#0a0a0a', surface: '#141414', 'surface-2': '#1e1e1e', 'surface-3': '#262626',
  'surface-elevated': '#1a1a1a', 'surface-glass': 'rgba(24, 24, 27, 0.95)',
  'surface-overlay': 'rgba(255, 255, 255, 0.05)',
  border: '#2a2a2a', 'border-strong': '#404040',
  text: '#e4e4e7', 'text-muted': '#71717a', 'text-on-accent': '#fff', 'text-inverse': '#000',
  'text-link': '#60a5fa',
  accent: '#3b82f6', 'accent-hover': '#2563eb', 'accent-muted': 'rgba(59, 130, 246, 0.15)',
  danger: '#ef4444', success: '#22c55e', warning: '#f59e0b', info: '#60a5fa',
  'focus-ring': '#3b82f6',
  purple: '#a855f7', orange: '#f97316', cyan: '#22d3ee', indigo: '#6366f1',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.4)',
}, {
  'syntax-property': '#7dd3fc', 'syntax-string': '#86efac', 'syntax-number': '#fbbf24',
  'syntax-boolean': '#c084fc', 'syntax-null': '#f87171', 'syntax-operator': '#71717a',
  'syntax-punctuation': '#52525b',
  'annotation-red': '#ef4444', 'annotation-orange': '#f97316', 'annotation-yellow': '#eab308',
  'annotation-green': '#22c55e', 'annotation-blue': '#3b82f6', 'annotation-purple': '#8b5cf6',
})

const light = theme('light', 'Light', 'light', 'default', 'Default light theme', {
  bg: '#f8f9fa', surface: '#ffffff', 'surface-2': '#f0f1f3', 'surface-3': '#e5e7eb',
  'surface-elevated': '#ffffff', 'surface-glass': 'rgba(255, 255, 255, 0.95)',
  'surface-overlay': 'rgba(0, 0, 0, 0.04)',
  border: '#d4d6db', 'border-strong': '#9ca3af',
  text: '#1a1a1a', 'text-muted': '#6b7280', 'text-on-accent': '#fff', 'text-inverse': '#fff',
  'text-link': '#2563eb',
  accent: '#2563eb', 'accent-hover': '#1d4ed8', 'accent-muted': 'rgba(37, 99, 235, 0.12)',
  danger: '#dc2626', success: '#16a34a', warning: '#d97706', info: '#2563eb',
  'focus-ring': '#2563eb',
  purple: '#9333ea', orange: '#ea580c', cyan: '#0891b2', indigo: '#4f46e5',
  overlay: 'rgba(0, 0, 0, 0.3)', shadow: 'rgba(0, 0, 0, 0.12)',
}, {
  'syntax-property': '#0369a1', 'syntax-string': '#15803d', 'syntax-number': '#b45309',
  'syntax-boolean': '#7e22ce', 'syntax-null': '#dc2626', 'syntax-operator': '#6b7280',
  'syntax-punctuation': '#9ca3af',
  'annotation-red': '#dc2626', 'annotation-orange': '#ea580c', 'annotation-yellow': '#ca8a04',
  'annotation-green': '#16a34a', 'annotation-blue': '#2563eb', 'annotation-purple': '#7c3aed',
})

const highContrastDark = theme('high-contrast-dark', 'High Contrast Dark', 'dark', 'high-contrast',
  'Maximum contrast for low-vision users (WCAG AAA)', {
  bg: '#000000', surface: '#0a0a0a', 'surface-2': '#1a1a1a', 'surface-3': '#262626',
  'surface-elevated': '#1a1a1a', 'surface-glass': 'rgba(10, 10, 10, 0.97)',
  'surface-overlay': 'rgba(255, 255, 255, 0.08)',
  border: '#6e6e6e', 'border-strong': '#ffffff',
  text: '#ffffff', 'text-muted': '#c0c0c0', 'text-on-accent': '#000000', 'text-inverse': '#000000',
  'text-link': '#6ec6ff',
  accent: '#4da6ff', 'accent-hover': '#80bfff', 'accent-muted': 'rgba(77, 166, 255, 0.2)',
  danger: '#ff6b6b', success: '#5eff5a', warning: '#ffda44', info: '#6ec6ff',
  'focus-ring': '#ffffff',
  purple: '#d8b4fe', orange: '#fdba74', cyan: '#67e8f9', indigo: '#a5b4fc',
  overlay: 'rgba(0, 0, 0, 0.7)', shadow: 'rgba(0, 0, 0, 0.6)',
}, {
  'syntax-property': '#67e8f9', 'syntax-string': '#5eff5a', 'syntax-number': '#ffda44',
  'syntax-boolean': '#d8b4fe', 'syntax-null': '#ff6b6b', 'syntax-operator': '#c0c0c0',
  'syntax-punctuation': '#6e6e6e',
  'annotation-red': '#ff6b6b', 'annotation-orange': '#fdba74', 'annotation-yellow': '#ffda44',
  'annotation-green': '#5eff5a', 'annotation-blue': '#4da6ff', 'annotation-purple': '#d8b4fe',
})

const highContrastLight = theme('high-contrast-light', 'High Contrast Light', 'light', 'high-contrast',
  'Maximum contrast on white (WCAG AAA)', {
  bg: '#ffffff', surface: '#ffffff', 'surface-2': '#f3f4f6', 'surface-3': '#e5e7eb',
  'surface-elevated': '#ffffff', 'surface-glass': 'rgba(255, 255, 255, 0.97)',
  'surface-overlay': 'rgba(0, 0, 0, 0.06)',
  border: '#6b7280', 'border-strong': '#000000',
  text: '#000000', 'text-muted': '#374151', 'text-on-accent': '#ffffff', 'text-inverse': '#ffffff',
  'text-link': '#0050a0',
  accent: '#0050a0', 'accent-hover': '#003d7a', 'accent-muted': 'rgba(0, 80, 160, 0.15)',
  danger: '#c50000', success: '#007a00', warning: '#8a5700', info: '#0050a0',
  'focus-ring': '#000000',
  purple: '#6b21a8', orange: '#9a3412', cyan: '#0e7490', indigo: '#3730a3',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.2)',
}, {
  'syntax-property': '#0e7490', 'syntax-string': '#007a00', 'syntax-number': '#8a5700',
  'syntax-boolean': '#6b21a8', 'syntax-null': '#c50000', 'syntax-operator': '#374151',
  'syntax-punctuation': '#6b7280',
  'annotation-red': '#c50000', 'annotation-orange': '#9a3412', 'annotation-yellow': '#8a5700',
  'annotation-green': '#007a00', 'annotation-blue': '#0050a0', 'annotation-purple': '#6b21a8',
})

const deuteranopia = theme('deuteranopia', 'Deuteranopia', 'dark', 'accessibility',
  'Optimized for red-green color blindness', {
  bg: '#0f1117', surface: '#181a22', 'surface-2': '#22242e', 'surface-3': '#2c2e3a',
  'surface-elevated': '#22242e', 'surface-glass': 'rgba(24, 26, 34, 0.95)',
  'surface-overlay': 'rgba(255, 255, 255, 0.05)',
  border: '#363846', 'border-strong': '#525466',
  text: '#e8e6f0', 'text-muted': '#8b8d9e', 'text-on-accent': '#0f1117', 'text-inverse': '#0f1117',
  'text-link': '#56b4e9',
  accent: '#56b4e9', 'accent-hover': '#7cc4ef', 'accent-muted': 'rgba(86, 180, 233, 0.15)',
  danger: '#e69f00', success: '#56b4e9', warning: '#f0e442', info: '#cc79a7',
  'focus-ring': '#56b4e9',
  purple: '#cc79a7', orange: '#e69f00', cyan: '#56b4e9', indigo: '#0072b2',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.4)',
}, {
  'severity-critical': '#e69f00', 'severity-serious': '#e69f00',
  'severity-moderate': '#f0e442', 'severity-minor': '#8b8d9e',
  'syntax-property': '#56b4e9', 'syntax-string': '#0072b2', 'syntax-number': '#f0e442',
  'syntax-boolean': '#cc79a7', 'syntax-null': '#e69f00', 'syntax-operator': '#8b8d9e',
  'syntax-punctuation': '#525466',
  'annotation-red': '#e69f00', 'annotation-orange': '#d55e00', 'annotation-yellow': '#f0e442',
  'annotation-green': '#009e73', 'annotation-blue': '#56b4e9', 'annotation-purple': '#cc79a7',
})

const monokai = theme('monokai', 'Monokai', 'dark', 'editor',
  'Classic warm dark theme', {
  bg: '#272822', surface: '#2d2e27', 'surface-2': '#383930', 'surface-3': '#434439',
  'surface-elevated': '#3e3d32', 'surface-glass': 'rgba(45, 46, 39, 0.95)',
  'surface-overlay': 'rgba(255, 255, 255, 0.05)',
  border: '#4e504a', 'border-strong': '#6a6c65',
  text: '#f8f8f2', 'text-muted': '#8f908a', 'text-on-accent': '#272822', 'text-inverse': '#272822',
  'text-link': '#66d9ef',
  accent: '#a6e22e', 'accent-hover': '#b6f23e', 'accent-muted': 'rgba(166, 226, 46, 0.15)',
  danger: '#f92672', success: '#a6e22e', warning: '#e6db74', info: '#66d9ef',
  'focus-ring': '#a6e22e',
  purple: '#ae81ff', orange: '#fd971f', cyan: '#66d9ef', indigo: '#ae81ff',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.4)',
}, {
  'syntax-property': '#66d9ef', 'syntax-string': '#e6db74', 'syntax-number': '#ae81ff',
  'syntax-boolean': '#ae81ff', 'syntax-null': '#f92672', 'syntax-operator': '#f92672',
  'syntax-punctuation': '#8f908a',
  'annotation-red': '#f92672', 'annotation-orange': '#fd971f', 'annotation-yellow': '#e6db74',
  'annotation-green': '#a6e22e', 'annotation-blue': '#66d9ef', 'annotation-purple': '#ae81ff',
})

const solarizedDark = theme('solarized-dark', 'Solarized Dark', 'dark', 'editor',
  'Ethan Schoonover\'s precision dark palette', {
  bg: '#002b36', surface: '#073642', 'surface-2': '#0a4050', 'surface-3': '#0d4f5f',
  'surface-elevated': '#073642', 'surface-glass': 'rgba(7, 54, 66, 0.95)',
  'surface-overlay': 'rgba(255, 255, 255, 0.05)',
  border: '#2a5c6b', 'border-strong': '#93a1a1',
  text: '#839496', 'text-muted': '#586e75', 'text-on-accent': '#fdf6e3', 'text-inverse': '#002b36',
  'text-link': '#268bd2',
  accent: '#268bd2', 'accent-hover': '#2e9ee6', 'accent-muted': 'rgba(38, 139, 210, 0.15)',
  danger: '#dc322f', success: '#859900', warning: '#b58900', info: '#268bd2',
  'focus-ring': '#268bd2',
  purple: '#6c71c4', orange: '#cb4b16', cyan: '#2aa198', indigo: '#6c71c4',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.4)',
}, {
  'syntax-property': '#268bd2', 'syntax-string': '#2aa198', 'syntax-number': '#d33682',
  'syntax-boolean': '#6c71c4', 'syntax-null': '#dc322f', 'syntax-operator': '#586e75',
  'syntax-punctuation': '#586e75',
  'annotation-red': '#dc322f', 'annotation-orange': '#cb4b16', 'annotation-yellow': '#b58900',
  'annotation-green': '#859900', 'annotation-blue': '#268bd2', 'annotation-purple': '#6c71c4',
})

const solarizedLight = theme('solarized-light', 'Solarized Light', 'light', 'editor',
  'Ethan Schoonover\'s precision light palette', {
  bg: '#fdf6e3', surface: '#eee8d5', 'surface-2': '#e8e1cc', 'surface-3': '#ddd6c1',
  'surface-elevated': '#eee8d5', 'surface-glass': 'rgba(238, 232, 213, 0.95)',
  'surface-overlay': 'rgba(0, 0, 0, 0.04)',
  border: '#d0c8b0', 'border-strong': '#93a1a1',
  text: '#657b83', 'text-muted': '#93a1a1', 'text-on-accent': '#fdf6e3', 'text-inverse': '#fdf6e3',
  'text-link': '#268bd2',
  accent: '#268bd2', 'accent-hover': '#1a6aab', 'accent-muted': 'rgba(38, 139, 210, 0.12)',
  danger: '#dc322f', success: '#859900', warning: '#b58900', info: '#268bd2',
  'focus-ring': '#268bd2',
  purple: '#6c71c4', orange: '#cb4b16', cyan: '#2aa198', indigo: '#6c71c4',
  overlay: 'rgba(0, 0, 0, 0.3)', shadow: 'rgba(0, 0, 0, 0.12)',
}, {
  'syntax-property': '#268bd2', 'syntax-string': '#2aa198', 'syntax-number': '#d33682',
  'syntax-boolean': '#6c71c4', 'syntax-null': '#dc322f', 'syntax-operator': '#93a1a1',
  'syntax-punctuation': '#93a1a1',
  'annotation-red': '#dc322f', 'annotation-orange': '#cb4b16', 'annotation-yellow': '#b58900',
  'annotation-green': '#859900', 'annotation-blue': '#268bd2', 'annotation-purple': '#6c71c4',
})

const nord = theme('nord', 'Nord', 'dark', 'editor',
  'Arctic, muted blue-gray palette', {
  bg: '#2e3440', surface: '#3b4252', 'surface-2': '#434c5e', 'surface-3': '#4c566a',
  'surface-elevated': '#3b4252', 'surface-glass': 'rgba(59, 66, 82, 0.95)',
  'surface-overlay': 'rgba(255, 255, 255, 0.05)',
  border: '#4c566a', 'border-strong': '#d8dee9',
  text: '#eceff4', 'text-muted': '#7b88a1', 'text-on-accent': '#2e3440', 'text-inverse': '#2e3440',
  'text-link': '#88c0d0',
  accent: '#88c0d0', 'accent-hover': '#8fbcbb', 'accent-muted': 'rgba(136, 192, 208, 0.15)',
  danger: '#bf616a', success: '#a3be8c', warning: '#ebcb8b', info: '#81a1c1',
  'focus-ring': '#88c0d0',
  purple: '#b48ead', orange: '#d08770', cyan: '#88c0d0', indigo: '#81a1c1',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.35)',
}, {
  'syntax-property': '#81a1c1', 'syntax-string': '#a3be8c', 'syntax-number': '#b48ead',
  'syntax-boolean': '#81a1c1', 'syntax-null': '#bf616a', 'syntax-operator': '#81a1c1',
  'syntax-punctuation': '#4c566a',
  'annotation-red': '#bf616a', 'annotation-orange': '#d08770', 'annotation-yellow': '#ebcb8b',
  'annotation-green': '#a3be8c', 'annotation-blue': '#88c0d0', 'annotation-purple': '#b48ead',
})

const oneDark = theme('one-dark', 'One Dark', 'dark', 'editor',
  'Atom-inspired dark theme', {
  bg: '#282c34', surface: '#21252b', 'surface-2': '#2c313a', 'surface-3': '#353b45',
  'surface-elevated': '#2c313a', 'surface-glass': 'rgba(33, 37, 43, 0.95)',
  'surface-overlay': 'rgba(255, 255, 255, 0.05)',
  border: '#3e4451', 'border-strong': '#5c6370',
  text: '#abb2bf', 'text-muted': '#5c6370', 'text-on-accent': '#282c34', 'text-inverse': '#282c34',
  'text-link': '#61afef',
  accent: '#61afef', 'accent-hover': '#74baf2', 'accent-muted': 'rgba(97, 175, 239, 0.15)',
  danger: '#e06c75', success: '#98c379', warning: '#e5c07b', info: '#61afef',
  'focus-ring': '#61afef',
  purple: '#c678dd', orange: '#d19a66', cyan: '#56b6c2', indigo: '#61afef',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.4)',
}, {
  'syntax-property': '#61afef', 'syntax-string': '#98c379', 'syntax-number': '#d19a66',
  'syntax-boolean': '#d19a66', 'syntax-null': '#e06c75', 'syntax-operator': '#56b6c2',
  'syntax-punctuation': '#5c6370',
  'annotation-red': '#e06c75', 'annotation-orange': '#d19a66', 'annotation-yellow': '#e5c07b',
  'annotation-green': '#98c379', 'annotation-blue': '#61afef', 'annotation-purple': '#c678dd',
})

const dracula = theme('dracula', 'Dracula', 'dark', 'editor',
  'Purple accent, vibrant dark theme', {
  bg: '#282a36', surface: '#44475a', 'surface-2': '#383a4e', 'surface-3': '#4d5066',
  'surface-elevated': '#44475a', 'surface-glass': 'rgba(68, 71, 90, 0.95)',
  'surface-overlay': 'rgba(255, 255, 255, 0.05)',
  border: '#6272a4', 'border-strong': '#f8f8f2',
  text: '#f8f8f2', 'text-muted': '#6272a4', 'text-on-accent': '#282a36', 'text-inverse': '#282a36',
  'text-link': '#8be9fd',
  accent: '#bd93f9', 'accent-hover': '#caa6fc', 'accent-muted': 'rgba(189, 147, 249, 0.15)',
  danger: '#ff5555', success: '#50fa7b', warning: '#f1fa8c', info: '#8be9fd',
  'focus-ring': '#bd93f9',
  purple: '#bd93f9', orange: '#ffb86c', cyan: '#8be9fd', indigo: '#bd93f9',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.4)',
}, {
  'syntax-property': '#8be9fd', 'syntax-string': '#f1fa8c', 'syntax-number': '#bd93f9',
  'syntax-boolean': '#bd93f9', 'syntax-null': '#ff5555', 'syntax-operator': '#ff79c6',
  'syntax-punctuation': '#6272a4',
  'annotation-red': '#ff5555', 'annotation-orange': '#ffb86c', 'annotation-yellow': '#f1fa8c',
  'annotation-green': '#50fa7b', 'annotation-blue': '#8be9fd', 'annotation-purple': '#bd93f9',
})

const githubDark = theme('github-dark', 'GitHub Dark', 'dark', 'editor',
  'GitHub\'s dark theme', {
  bg: '#0d1117', surface: '#161b22', 'surface-2': '#1c2129', 'surface-3': '#21262d',
  'surface-elevated': '#1c2129', 'surface-glass': 'rgba(22, 27, 34, 0.95)',
  'surface-overlay': 'rgba(255, 255, 255, 0.04)',
  border: '#30363d', 'border-strong': '#484f58',
  text: '#e6edf3', 'text-muted': '#7d8590', 'text-on-accent': '#ffffff', 'text-inverse': '#0d1117',
  'text-link': '#58a6ff',
  accent: '#58a6ff', 'accent-hover': '#79b8ff', 'accent-muted': 'rgba(88, 166, 255, 0.15)',
  danger: '#f85149', success: '#3fb950', warning: '#d29922', info: '#58a6ff',
  'focus-ring': '#58a6ff',
  purple: '#bc8cff', orange: '#f0883e', cyan: '#39d2e0', indigo: '#6e7681',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.4)',
}, {
  'syntax-property': '#79c0ff', 'syntax-string': '#a5d6ff', 'syntax-number': '#79c0ff',
  'syntax-boolean': '#79c0ff', 'syntax-null': '#f85149', 'syntax-operator': '#7d8590',
  'syntax-punctuation': '#484f58',
  'annotation-red': '#f85149', 'annotation-orange': '#f0883e', 'annotation-yellow': '#d29922',
  'annotation-green': '#3fb950', 'annotation-blue': '#58a6ff', 'annotation-purple': '#bc8cff',
})

const githubLight = theme('github-light', 'GitHub Light', 'light', 'editor',
  'GitHub\'s light theme', {
  bg: '#ffffff', surface: '#f6f8fa', 'surface-2': '#eaeef2', 'surface-3': '#d0d7de',
  'surface-elevated': '#ffffff', 'surface-glass': 'rgba(246, 248, 250, 0.95)',
  'surface-overlay': 'rgba(0, 0, 0, 0.04)',
  border: '#d0d7de', 'border-strong': '#8c959f',
  text: '#1f2328', 'text-muted': '#656d76', 'text-on-accent': '#ffffff', 'text-inverse': '#ffffff',
  'text-link': '#0969da',
  accent: '#0969da', 'accent-hover': '#0550ae', 'accent-muted': 'rgba(9, 105, 218, 0.12)',
  danger: '#cf222e', success: '#1a7f37', warning: '#9a6700', info: '#0969da',
  'focus-ring': '#0969da',
  purple: '#8250df', orange: '#bc4c00', cyan: '#0969da', indigo: '#6e7781',
  overlay: 'rgba(0, 0, 0, 0.3)', shadow: 'rgba(0, 0, 0, 0.1)',
}, {
  'syntax-property': '#0550ae', 'syntax-string': '#0a3069', 'syntax-number': '#0550ae',
  'syntax-boolean': '#0550ae', 'syntax-null': '#cf222e', 'syntax-operator': '#656d76',
  'syntax-punctuation': '#8c959f',
  'annotation-red': '#cf222e', 'annotation-orange': '#bc4c00', 'annotation-yellow': '#9a6700',
  'annotation-green': '#1a7f37', 'annotation-blue': '#0969da', 'annotation-purple': '#8250df',
})

const catppuccinMocha = theme('catppuccin-mocha', 'Catppuccin Mocha', 'dark', 'editor',
  'Pastel-on-dark, warm and cozy', {
  bg: '#1e1e2e', surface: '#181825', 'surface-2': '#313244', 'surface-3': '#45475a',
  'surface-elevated': '#313244', 'surface-glass': 'rgba(30, 30, 46, 0.95)',
  'surface-overlay': 'rgba(255, 255, 255, 0.05)',
  border: '#45475a', 'border-strong': '#585b70',
  text: '#cdd6f4', 'text-muted': '#6c7086', 'text-on-accent': '#1e1e2e', 'text-inverse': '#1e1e2e',
  'text-link': '#89b4fa',
  accent: '#b4befe', 'accent-hover': '#cba6f7', 'accent-muted': 'rgba(180, 190, 254, 0.15)',
  danger: '#f38ba8', success: '#a6e3a1', warning: '#f9e2af', info: '#89b4fa',
  'focus-ring': '#b4befe',
  purple: '#cba6f7', orange: '#fab387', cyan: '#94e2d5', indigo: '#b4befe',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.4)',
}, {
  'syntax-property': '#89b4fa', 'syntax-string': '#a6e3a1', 'syntax-number': '#fab387',
  'syntax-boolean': '#cba6f7', 'syntax-null': '#f38ba8', 'syntax-operator': '#94e2d5',
  'syntax-punctuation': '#6c7086',
  'annotation-red': '#f38ba8', 'annotation-orange': '#fab387', 'annotation-yellow': '#f9e2af',
  'annotation-green': '#a6e3a1', 'annotation-blue': '#89b4fa', 'annotation-purple': '#cba6f7',
})

const gruvboxDark = theme('gruvbox-dark', 'Gruvbox Dark', 'dark', 'editor',
  'Retro warm browns and oranges', {
  bg: '#282828', surface: '#1d2021', 'surface-2': '#3c3836', 'surface-3': '#504945',
  'surface-elevated': '#3c3836', 'surface-glass': 'rgba(40, 40, 40, 0.95)',
  'surface-overlay': 'rgba(255, 255, 255, 0.05)',
  border: '#504945', 'border-strong': '#665c54',
  text: '#ebdbb2', 'text-muted': '#928374', 'text-on-accent': '#282828', 'text-inverse': '#282828',
  'text-link': '#83a598',
  accent: '#fe8019', 'accent-hover': '#d65d0e', 'accent-muted': 'rgba(254, 128, 25, 0.15)',
  danger: '#fb4934', success: '#b8bb26', warning: '#fabd2f', info: '#83a598',
  'focus-ring': '#fe8019',
  purple: '#d3869b', orange: '#fe8019', cyan: '#8ec07c', indigo: '#83a598',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.4)',
}, {
  'syntax-property': '#83a598', 'syntax-string': '#b8bb26', 'syntax-number': '#d3869b',
  'syntax-boolean': '#d3869b', 'syntax-null': '#fb4934', 'syntax-operator': '#8ec07c',
  'syntax-punctuation': '#928374',
  'annotation-red': '#fb4934', 'annotation-orange': '#fe8019', 'annotation-yellow': '#fabd2f',
  'annotation-green': '#b8bb26', 'annotation-blue': '#83a598', 'annotation-purple': '#d3869b',
})

const rosePine = theme('rose-pine', 'Rosé Pine', 'dark', 'editor',
  'Muted, elegant with dusty rose and gold', {
  bg: '#191724', surface: '#1f1d2e', 'surface-2': '#26233a', 'surface-3': '#2a2837',
  'surface-elevated': '#26233a', 'surface-glass': 'rgba(25, 23, 36, 0.95)',
  'surface-overlay': 'rgba(255, 255, 255, 0.04)',
  border: '#2a2837', 'border-strong': '#524f67',
  text: '#e0def4', 'text-muted': '#6e6a86', 'text-on-accent': '#191724', 'text-inverse': '#191724',
  'text-link': '#9ccfd8',
  accent: '#c4a7e7', 'accent-hover': '#b490d4', 'accent-muted': 'rgba(196, 167, 231, 0.15)',
  danger: '#eb6f92', success: '#9ccfd8', warning: '#f6c177', info: '#31748f',
  'focus-ring': '#c4a7e7',
  purple: '#c4a7e7', orange: '#f6c177', cyan: '#9ccfd8', indigo: '#31748f',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.4)',
}, {
  'syntax-property': '#9ccfd8', 'syntax-string': '#f6c177', 'syntax-number': '#c4a7e7',
  'syntax-boolean': '#c4a7e7', 'syntax-null': '#eb6f92', 'syntax-operator': '#31748f',
  'syntax-punctuation': '#6e6a86',
  'annotation-red': '#eb6f92', 'annotation-orange': '#f6c177', 'annotation-yellow': '#ebbcba',
  'annotation-green': '#9ccfd8', 'annotation-blue': '#31748f', 'annotation-purple': '#c4a7e7',
})

const synthwave84 = theme('synthwave-84', 'Synthwave \'84', 'dark', 'editor',
  'Neon retro-futuristic pink and cyan', {
  bg: '#262335', surface: '#241b2f', 'surface-2': '#2a2139', 'surface-3': '#342b44',
  'surface-elevated': '#2a2139', 'surface-glass': 'rgba(38, 35, 53, 0.95)',
  'surface-overlay': 'rgba(255, 255, 255, 0.05)',
  border: '#3b3450', 'border-strong': '#504672',
  text: '#e0d8f0', 'text-muted': '#848bbd', 'text-on-accent': '#262335', 'text-inverse': '#262335',
  'text-link': '#36f9f6',
  accent: '#36f9f6', 'accent-hover': '#2de0dd', 'accent-muted': 'rgba(54, 249, 246, 0.15)',
  danger: '#ff7edb', success: '#72f1b8', warning: '#fede5d', info: '#36f9f6',
  'focus-ring': '#36f9f6',
  purple: '#ff7edb', orange: '#f97e72', cyan: '#36f9f6', indigo: '#b381c5',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.5)',
}, {
  'syntax-property': '#36f9f6', 'syntax-string': '#72f1b8', 'syntax-number': '#f97e72',
  'syntax-boolean': '#ff7edb', 'syntax-null': '#fe4450', 'syntax-operator': '#fede5d',
  'syntax-punctuation': '#848bbd',
  'annotation-red': '#fe4450', 'annotation-orange': '#f97e72', 'annotation-yellow': '#fede5d',
  'annotation-green': '#72f1b8', 'annotation-blue': '#36f9f6', 'annotation-purple': '#ff7edb',
})

const cobalt = theme('cobalt', 'Cobalt', 'dark', 'editor',
  'Classic bright blue background with bold contrast', {
  bg: '#193549', surface: '#15232d', 'surface-2': '#1f4662', 'surface-3': '#245578',
  'surface-elevated': '#1f4662', 'surface-glass': 'rgba(25, 53, 73, 0.95)',
  'surface-overlay': 'rgba(255, 255, 255, 0.06)',
  border: '#1f4662', 'border-strong': '#3b7ea1',
  text: '#ffffff', 'text-muted': '#6a9fb5', 'text-on-accent': '#193549', 'text-inverse': '#193549',
  'text-link': '#80fcff',
  accent: '#ffc600', 'accent-hover': '#e6b200', 'accent-muted': 'rgba(255, 198, 0, 0.15)',
  danger: '#ff628c', success: '#3ad900', warning: '#ffc600', info: '#80fcff',
  'focus-ring': '#ffc600',
  purple: '#ff9d00', orange: '#ff9d00', cyan: '#80fcff', indigo: '#9effff',
  overlay: 'rgba(0, 0, 0, 0.5)', shadow: 'rgba(0, 0, 0, 0.5)',
}, {
  'syntax-property': '#9effff', 'syntax-string': '#3ad900', 'syntax-number': '#ff9d00',
  'syntax-boolean': '#ff9d00', 'syntax-null': '#ff628c', 'syntax-operator': '#ffc600',
  'syntax-punctuation': '#6a9fb5',
  'annotation-red': '#ff628c', 'annotation-orange': '#ff9d00', 'annotation-yellow': '#ffc600',
  'annotation-green': '#3ad900', 'annotation-blue': '#80fcff', 'annotation-purple': '#9effff',
})

// ─── Exports ────────────────────────────────────────────────────────────────

export const BUILTIN_THEMES: ShellTheme[] = [
  dark, light,
  highContrastDark, highContrastLight,
  deuteranopia,
  monokai, solarizedDark, solarizedLight,
  nord, oneDark, dracula,
  githubDark, githubLight,
  catppuccinMocha, gruvboxDark, rosePine, synthwave84, cobalt,
]

export const BUILTIN_THEME_MAP = new Map<string, ShellTheme>(
  BUILTIN_THEMES.map(t => [t.id, t]),
)

/** Default theme used as fallback. */
export const DEFAULT_THEME = dark
