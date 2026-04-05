import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { BUILTIN_THEME_MAP, BUILTIN_THEMES, DEFAULT_THEME, THEME_COLOR_KEYS } from '../themes'
import type { ShellTheme, ShellThemeColors } from '../themes'

// ─── localStorage keys ──────────────────────────────────────────────────────

const KEY_THEME = 'annotask:shellTheme'
const KEY_SYSTEM_PAIR = 'annotask:shellSystemThemes'
const KEY_CUSTOM = 'annotask:shellCustomThemes'
const KEY_LEGACY = 'annotask:themeMode'

// ─── Singleton state ────────────────────────────────────────────────────────

let _initialized = false
const activeThemeId = ref('system')
const systemPair = ref<[string, string]>(['dark', 'light'])
const customThemes = ref<ShellTheme[]>([])
const resolvedTheme = ref<ShellTheme>(DEFAULT_THEME)
const resolvedType = ref<'dark' | 'light'>('dark')

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function getSystemPreference(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function allThemesMap(): Map<string, ShellTheme> {
  const map = new Map(BUILTIN_THEME_MAP)
  for (const t of customThemes.value) map.set(t.id, t)
  return map
}

/** Fill missing keys in a custom theme's colors from DEFAULT_THEME. */
function validateColors(colors: Partial<ShellThemeColors>): ShellThemeColors {
  const result = { ...DEFAULT_THEME.colors }
  for (const key of THEME_COLOR_KEYS) {
    if (colors[key]) result[key] = colors[key]!
  }
  return result
}

function lookupTheme(id: string): ShellTheme {
  const map = allThemesMap()
  return map.get(id) || DEFAULT_THEME
}

function resolve(id: string): ShellTheme {
  if (id === 'system') {
    const pref = getSystemPreference()
    const targetId = pref === 'dark' ? systemPair.value[0] : systemPair.value[1]
    return lookupTheme(targetId)
  }
  return lookupTheme(id)
}

function applyTheme(theme: ShellTheme) {
  resolvedTheme.value = theme
  resolvedType.value = theme.type

  const el = document.documentElement
  // Set all CSS custom properties
  for (const key of THEME_COLOR_KEYS) {
    el.style.setProperty(`--${key}`, theme.colors[key])
  }
  // Set data attribute and class for backward compat / external CSS
  el.setAttribute('data-shell-theme', theme.id)
  el.classList.toggle('light', theme.type === 'light')
  el.classList.toggle('dark', theme.type === 'dark')
}

function persistThemeId(id: string) {
  localStorage.setItem(KEY_THEME, id)
}

function persistSystemPair(pair: [string, string]) {
  localStorage.setItem(KEY_SYSTEM_PAIR, JSON.stringify(pair))
}

function persistCustomThemes(themes: ShellTheme[]) {
  localStorage.setItem(KEY_CUSTOM, JSON.stringify(themes))
}

// ─── Migration from legacy useThemeMode ─────────────────────────────────────

function migrateLegacy() {
  const existing = localStorage.getItem(KEY_THEME)
  if (existing) return existing // already migrated

  const legacy = localStorage.getItem(KEY_LEGACY)
  let id = 'system'
  if (legacy === 'dark') id = 'dark'
  else if (legacy === 'light') id = 'light'
  // 'system' or missing → 'system'

  localStorage.setItem(KEY_THEME, id)
  localStorage.removeItem(KEY_LEGACY)
  return id
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function useShellTheme() {
  if (!_initialized) {
    _initialized = true

    // Load custom themes
    const rawCustom = safeJsonParse<ShellTheme[]>(localStorage.getItem(KEY_CUSTOM), [])
    customThemes.value = rawCustom.map(t => ({
      ...t,
      isCustom: true,
      group: 'custom' as const,
      colors: validateColors(t.colors),
    }))

    // Load system pair
    systemPair.value = safeJsonParse<[string, string]>(
      localStorage.getItem(KEY_SYSTEM_PAIR),
      ['dark', 'light'],
    )

    // Migrate and load active theme
    const id = migrateLegacy()
    activeThemeId.value = id

    // Apply immediately
    applyTheme(resolve(id))

    // Watch for theme changes
    watch(activeThemeId, (id) => {
      persistThemeId(id)
      applyTheme(resolve(id))
    })

    watch(systemPair, (pair) => {
      persistSystemPair(pair)
      if (activeThemeId.value === 'system') {
        applyTheme(resolve('system'))
      }
    }, { deep: true })
  }

  // Listen for system preference changes
  let mql: MediaQueryList | null = null
  const handler = () => {
    if (activeThemeId.value === 'system') {
      applyTheme(resolve('system'))
    }
  }

  onMounted(() => {
    mql = window.matchMedia('(prefers-color-scheme: light)')
    mql.addEventListener('change', handler)
  })

  onUnmounted(() => {
    mql?.removeEventListener('change', handler)
  })

  // ── Actions ──

  function setTheme(id: string) {
    activeThemeId.value = id
  }

  function setSystemThemes(darkId: string, lightId: string) {
    systemPair.value = [darkId, lightId]
  }

  function saveCustomTheme(theme: ShellTheme) {
    const idx = customThemes.value.findIndex(t => t.id === theme.id)
    const validated: ShellTheme = {
      ...theme,
      isCustom: true,
      group: 'custom',
      colors: validateColors(theme.colors),
    }
    if (idx >= 0) {
      customThemes.value[idx] = validated
    } else {
      customThemes.value.push(validated)
    }
    persistCustomThemes(customThemes.value)
    // Re-apply if this is the active theme
    if (activeThemeId.value === theme.id) {
      applyTheme(validated)
    }
  }

  function deleteCustomTheme(id: string) {
    customThemes.value = customThemes.value.filter(t => t.id !== id)
    persistCustomThemes(customThemes.value)
    // Fall back if deleted theme was active
    if (activeThemeId.value === id) {
      activeThemeId.value = 'dark'
    }
  }

  function duplicateTheme(sourceId: string, newName: string): ShellTheme {
    const source = lookupTheme(sourceId)
    const newId = `custom:${newName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`
    const dup: ShellTheme = {
      id: newId,
      name: newName,
      type: source.type,
      group: 'custom',
      isCustom: true,
      colors: { ...source.colors },
    }
    saveCustomTheme(dup)
    return dup
  }

  const allThemes: ComputedRef<ShellTheme[]> = computed(() => [
    ...BUILTIN_THEMES,
    ...customThemes.value,
  ])

  return {
    activeThemeId: activeThemeId as Ref<string>,
    resolvedTheme: resolvedTheme as Ref<ShellTheme>,
    resolvedType: resolvedType as Ref<'dark' | 'light'>,
    systemPair: systemPair as Ref<[string, string]>,
    customThemes: customThemes as Ref<ShellTheme[]>,
    allThemes,
    setTheme,
    setSystemThemes,
    saveCustomTheme,
    deleteCustomTheme,
    duplicateTheme,
  }
}
