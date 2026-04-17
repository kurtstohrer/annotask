import { computed } from 'vue'
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
 */
export function useColorPalette() {
  const { designSpec } = useDesignSpec()

  const tokenCategory = computed<ColorPaletteCategory | null>(() => {
    const colors = designSpec.value?.colors
    if (!colors?.length) return null
    const swatches: ColorSwatch[] = colors.map((t) => ({
      label: t.role,
      value: t.value,
      source: 'token' as const,
      role: t.role,
    }))
    return { name: 'Tokens', swatches }
  })

  return { tokenCategory }
}
