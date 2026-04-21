import { ref, computed } from 'vue'
import type { AnnotaskDesignSpec, DesignSpecTheme } from '../../schema'
import type { ColorSchemeResult } from '../../shared/bridge-types'
import { on as wsOn } from '../services/wsClient'

interface DesignSpecState extends AnnotaskDesignSpec {
  initialized: boolean
}

const designSpec = ref<DesignSpecState | null>(null)
const isInitialized = ref(false)
const isLoading = ref(true)

let fetched = false

async function fetchDesignSpec() {
  try {
    const res = await fetch('/__annotask/api/design-spec')
    const data = await res.json()
    designSpec.value = data
    isInitialized.value = !!data.initialized
  } catch {
    designSpec.value = null
    isInitialized.value = false
  } finally {
    isLoading.value = false
  }
}

/**
 * Iframe's current color scheme, seeded from useIframeManager. Kept at module
 * scope so any view (palette popover, style editor, etc.) can resolve the
 * active design-spec variant without plumbing the signal through props.
 */
const activeColorScheme = ref<ColorSchemeResult | null>(null)

export function setActiveColorScheme(cs: ColorSchemeResult | null) {
  activeColorScheme.value = cs
}

/**
 * Resolve a ColorSchemeResult to a design-spec theme id. Marker match wins
 * (explicit DOM signal), then scheme-field match, then the provided fallback.
 * Exported so other composables can project a scheme onto the spec's variants.
 */
export function matchThemeId(
  cs: ColorSchemeResult | null | undefined,
  themes: DesignSpecTheme[],
  fallback: string,
): string {
  if (!cs) return fallback
  if (cs.marker) {
    const m = cs.marker
    for (const t of themes) {
      const sel = t.selector
      if (m.kind === 'attribute' && sel.kind === 'attribute' && sel.name === m.name
          && (sel.value === undefined || sel.value === m.value)
          && (sel.host === undefined || sel.host === m.host)) return t.id
      if (m.kind === 'class' && sel.kind === 'class' && sel.name === m.name
          && (sel.host === undefined || sel.host === m.host)) return t.id
    }
  }
  for (const t of themes) if (t.scheme === cs.scheme) return t.id
  return fallback
}

/**
 * The design-spec theme id that the iframe is currently rendering. Returns
 * the spec's defaultTheme (or 'default') when the scheme hasn't been seeded
 * or no variant matches.
 */
const activeThemeId = computed(() => {
  const spec = designSpec.value
  const themes = spec?.themes && spec.themes.length > 0 ? spec.themes : []
  const fallback = spec?.defaultTheme || themes[0]?.id || 'default'
  return matchThemeId(activeColorScheme.value, themes, fallback)
})

export function useDesignSpec() {
  if (!fetched) {
    fetched = true
    fetchDesignSpec()
    wsOn('designspec:updated', () => fetchDesignSpec())
  }
  return { designSpec, isInitialized, isLoading, activeThemeId, refetch: fetchDesignSpec }
}
