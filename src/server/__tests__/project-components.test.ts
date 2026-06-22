import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { scanProjectComponents, clearComponentCache } from '../component-scanner'

const PLANET_CARD_VUE = `<script setup lang="ts">
/** A card for one planet. */
defineProps<{
  planet: { id: string; name: string }
  active?: boolean
}>()
</script>
<template>
  <article class="planet-card"><slot /></article>
</template>
`

const BUTTON_TSX = `interface ButtonProps {
  label: string
  disabled?: boolean
}
export default function Button({ label, disabled }: ButtonProps) {
  return <button disabled={disabled}>{label}</button>
}
`

describe('scanProjectComponents', () => {
  let root: string

  async function write(rel: string, content: string): Promise<void> {
    const abs = path.join(root, rel)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content, 'utf-8')
  }

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-pc-'))
    clearComponentCache()
    await write('src/components/PlanetCard.vue', PLANET_CARD_VUE)
    await write('src/ui/Button.tsx', BUTTON_TSX)
    // Non-components that must be skipped.
    await write('src/router.ts', 'export const routes = []\n')
    await write('src/utils.js', 'export function x() {}\n')
  })

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true })
    clearComponentCache()
  })

  it('catalogs PascalCase src/ components with ./src/… module specifiers, sorted', async () => {
    const lib = await scanProjectComponents(root)
    expect(lib.name).toBe('Project')
    expect(lib.components.map((c) => c.name)).toEqual(['Button', 'PlanetCard'])
    const card = lib.components.find((c) => c.name === 'PlanetCard')!
    // The exact spec ensureComponentLoaded resolves via /__annotask/preview-module.
    expect(card.module).toBe('./src/components/PlanetCard.vue')
    expect(card.sourceFile).toBe(path.join(root, 'src/components/PlanetCard.vue'))
    const propNames = card.props.map((p) => p.name)
    expect(propNames).toContain('planet')
    expect(propNames).toContain('active')
    const button = lib.components.find((c) => c.name === 'Button')!
    expect(button.module).toBe('./src/ui/Button.tsx')
    expect(button.props.map((p) => p.name)).toContain('label')
  })

  it('returns an empty library when src/ is missing', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-pc-empty-'))
    try {
      clearComponentCache()
      const lib = await scanProjectComponents(empty)
      expect(lib.components).toEqual([])
    } finally {
      await fsp.rm(empty, { recursive: true, force: true })
    }
  })

  it('caches per TTL and resets via clearComponentCache', async () => {
    const first = await scanProjectComponents(root)
    await write('src/components/NewThing.vue', '<template><div>x</div></template>\n')
    // Warm cache → unchanged.
    const cached = await scanProjectComponents(root)
    expect(cached).toBe(first)
    clearComponentCache()
    const fresh = await scanProjectComponents(root)
    expect(fresh.components.map((c) => c.name)).toContain('NewThing')
  })
})
