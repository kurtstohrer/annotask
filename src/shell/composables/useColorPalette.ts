import { ref, computed, type Ref } from 'vue'
import { tailwindColors, SHADE_KEYS } from '../data/tailwindColors'

export interface ColorSwatch {
  label: string
  value: string
  source: 'tailwind' | 'css-var' | 'recent'
}

export interface ColorPaletteCategory {
  name: string
  swatches: ColorSwatch[]
}

// Shared recent colors across all instances
const recentColors = ref<ColorSwatch[]>([])
const MAX_RECENT = 20

export function rgbToHex(rgb: string): string {
  const match = rgb.match(/\d+/g)
  if (!match || match.length < 3) return '#000000'
  const [r, g, b] = match.map(Number)
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
}

/**
 * Test if a CSS value resolves to a color by setting it on a temp element
 * and reading back the computed value.
 */
function tryParseColor(value: string, doc: Document): string | null {
  if (!value || value === 'inherit' || value === 'initial' || value === 'unset') return null
  const el = doc.createElement('span')
  el.style.display = 'none'
  el.style.color = ''
  doc.body.appendChild(el)
  try {
    el.style.color = value
    const computed = doc.defaultView?.getComputedStyle(el).color
    if (!computed || computed === '') return null
    // If the browser resolved it, it's a valid color
    return rgbToHex(computed)
  } finally {
    el.remove()
  }
}

/**
 * Scan iframe :root for CSS custom properties that resolve to colors.
 */
function scanCssVariables(doc: Document): ColorSwatch[] {
  const root = doc.documentElement
  const varNames = new Set<string>()

  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText?.includes(':root')) {
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i]
            if (prop.startsWith('--')) varNames.add(prop)
          }
        }
      }
    } catch {
      // Cross-origin sheet — skip
    }
  }

  const cs = getComputedStyle(root)
  const results: ColorSwatch[] = []

  for (const name of varNames) {
    const raw = cs.getPropertyValue(name).trim()
    const hex = tryParseColor(raw, doc)
    if (hex) {
      results.push({ label: name, value: hex, source: 'css-var' })
    }
  }

  return results
}

export function useColorPalette(iframeDoc: Ref<Document | null>) {
  const cssVarSwatches = ref<ColorSwatch[]>([])
  let scanned = false

  const tailwindCategories = computed<ColorPaletteCategory[]>(() =>
    tailwindColors.map(scale => ({
      name: scale.name,
      swatches: SHADE_KEYS.map(shade => ({
        label: `${scale.name.toLowerCase()}-${shade}`,
        value: scale.shades[shade],
        source: 'tailwind' as const,
      })),
    }))
  )

  const cssVarCategory = computed<ColorPaletteCategory | null>(() => {
    if (cssVarSwatches.value.length === 0) return null
    return { name: 'App Variables', swatches: cssVarSwatches.value }
  })

  function refreshCssVars() {
    const doc = iframeDoc.value
    if (!doc) return
    cssVarSwatches.value = scanCssVariables(doc)
    scanned = true
  }

  function ensureScanned() {
    if (!scanned) refreshCssVars()
  }

  function addRecentColor(hex: string) {
    const normalized = hex.toLowerCase()
    recentColors.value = [
      { label: normalized, value: normalized, source: 'recent' as const },
      ...recentColors.value.filter(c => c.value !== normalized),
    ].slice(0, MAX_RECENT)
  }

  return {
    tailwindCategories,
    cssVarCategory,
    recentColors,
    ensureScanned,
    refreshCssVars,
    addRecentColor,
  }
}
