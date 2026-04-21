import { computed, type MaybeRefOrGetter, toValue } from 'vue'
import { useDesignSpec } from './useDesignSpec'

export interface ColorSwatch {
  label: string
  value: string
  source: 'token'
  /** Semantic token role (e.g. 'primary'). */
  role: string
}

export interface ColorPaletteCategory {
  name: string
  swatches: ColorSwatch[]
}

export function rgbToHex(rgb: string): string {
  const match = rgb.match(/\d+/g)
  if (!match || match.length < 3) return '#000000'
  const [r, g, b] = match.map(Number)
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
}

/**
 * Provides the project's design tokens (colors) as swatches for the
 * color picker. Tokens come from `useDesignSpec().designSpec.colors`.
 *
 * By default the palette follows the iframe's active theme variant so users
 * see the values they're actually rendering. Pass `themeIdOverride` (e.g.
 * from an in-popover variant switcher) to force a different variant.
 */
export function useColorPalette(themeIdOverride?: MaybeRefOrGetter<string | null | undefined>) {
  const { designSpec, activeThemeId } = useDesignSpec()

  const resolvedThemeId = computed(() => {
    const override = toValue(themeIdOverride)
    if (override) return override
    return activeThemeId.value
  })

  const tokenCategory = computed<ColorPaletteCategory | null>(() => {
    const colors = designSpec.value?.colors
    if (!colors?.length) return null
    const themeId = resolvedThemeId.value
    const fallbackThemeId = designSpec.value?.defaultTheme
    const swatches: ColorSwatch[] = colors.map((t) => {
      const values = t.values ?? {}
      // Prefer the active variant; fall back to the default; finally fall back
      // to whichever value exists so single-variant specs keep working.
      const value = (themeId ? values[themeId] : undefined)
        ?? (fallbackThemeId ? values[fallbackThemeId] : undefined)
        ?? Object.values(values)[0]
        ?? ''
      return {
        label: t.role,
        value,
        source: 'token' as const,
        role: t.role,
      }
    })
    return { name: 'Tokens', swatches }
  })

  return { tokenCategory, activeThemeId: resolvedThemeId }
}
