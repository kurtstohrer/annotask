import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { classifyBindings, clearBindingClassifyCache } from '../binding-classify'

// Mirrors the real /planets acceptance surface: a multi-line component usage
// inside v-for, literal attrs, expression-literals, bound text, literal text.
const PLANETS_PAGE_VUE = `<template>
  <div class="planets-page">
    <h1 class="title">Planets</h1>
    <p class="subtitle">{{ planets.length }} worlds</p>
    <span class="mixed"><em>hot</em> {{ sun.temp }} degrees</span>
    <Button label="Reset" :count="3" :active="selected !== null" @click="reset" />
    <section class="grid">
      <PlanetCard
        v-for="planet in filtered"
        :key="planet.id"
        :planet="planet"
        :active="selected?.id === planet.id"
        @select="onSelect"
      />
    </section>
    <Chip v-bind="chipProps" label="Spread" />
  </div>
</template>
<script setup lang="ts">
import PlanetCard from '../components/PlanetCard.vue'
const filtered = []
</script>
`

const PLANETS_PAGE_TSX = `import PlanetCard from './PlanetCard'

export default function PlanetsPage() {
  const planets: Array<{ id: string; name: string }> = []
  return (
    <div className="planets-page">
      <h1 className="title">Planets</h1>
      <p className="subtitle">{planets.length} worlds</p>
      <Button label="Reset" count={3} negative={-1} active={planets.length > 0} disabled />
      <section className="grid">
        {planets.map((planet) => (
          <PlanetCard key={planet.id} planet={planet} active={false} onSelect={() => {}} />
        ))}
      </section>
      <Chip {...chipProps} label="Spread" />
    </div>
  )
}
`

const PLANETS_PAGE_SVELTE = `<script>
  import PlanetCard from './PlanetCard.svelte'
  let planets = []
</script>

<div class="planets-page">
  <h1 class="title">Planets</h1>
  <p class="subtitle">{planets.length} worlds</p>
  <Button label="Reset" count={3} active={planets.length > 0} />
  {#each planets as planet}
    <PlanetCard planet={planet} active={false} />
  {/each}
</div>
`

describe('binding-classify', () => {
  let root: string

  async function write(rel: string, content: string): Promise<string> {
    const abs = path.join(root, rel)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content, 'utf-8')
    return rel
  }

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-bc-'))
    clearBindingClassifyCache()
    await write('src/pages/PlanetsPage.vue', PLANETS_PAGE_VUE)
    await write('src/pages/PlanetsPage.tsx', PLANETS_PAGE_TSX)
    await write('src/pages/PlanetsPage.svelte', PLANETS_PAGE_SVELTE)
  })

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  describe('vue', () => {
    it('classifies literal attrs, expression-literals, and bound expressions on one element', async () => {
      const r = await classifyBindings(root, 'src/pages/PlanetsPage.vue', 6, { tag: 'Button' })
      expect(r.analyzer).toBe('vue-sfc')
      expect(r.error).toBeUndefined()
      const byName = Object.fromEntries(r.props.map((p) => [p.name, p]))
      expect(byName.label).toMatchObject({ kind: 'literal', source: 'Reset' })
      expect(byName.label.expression_literal).toBeUndefined()
      expect(byName.count).toMatchObject({ kind: 'literal', source: '3', expression_literal: true })
      expect(byName.active).toMatchObject({ kind: 'bound', source: 'selected !== null' })
      // Event handlers are not editable props.
      expect(byName.click).toBeUndefined()
      expect(r.loop).toBeUndefined()
      expect(r.excerpt_hash).toHaveLength(16)
    })

    it('sees attrs on continuation lines of a multi-line opening tag and the enclosing v-for', async () => {
      const r = await classifyBindings(root, 'src/pages/PlanetsPage.vue', 8, { tag: 'PlanetCard' })
      expect(r.error).toBeUndefined()
      const byName = Object.fromEntries(r.props.map((p) => [p.name, p]))
      expect(byName.planet).toMatchObject({ kind: 'bound', source: 'planet' })
      expect(byName.active.kind).toBe('bound')
      // v-for on the element itself.
      expect(r.loop).toMatchObject({ iterable: 'filtered', alias: 'planet' })
    })

    it('marks every prop unknown under v-bind spread', async () => {
      const r = await classifyBindings(root, 'src/pages/PlanetsPage.vue', 16, { tag: 'Chip' })
      expect(r.error).toBeUndefined()
      const label = r.props.find((p) => p.name === 'label')
      expect(label).toMatchObject({ kind: 'unknown' })
      expect(label!.reason).toMatch(/spread/)
    })

    it('classifies text: literal, bound interpolation, mixed content', async () => {
      const h1 = await classifyBindings(root, 'src/pages/PlanetsPage.vue', 3, { tag: 'h1' })
      expect(h1.text).toMatchObject({ kind: 'literal', source: 'Planets' })

      const p = await classifyBindings(root, 'src/pages/PlanetsPage.vue', 4, { tag: 'p' })
      expect(p.text.kind).toBe('mixed') // "{{ planets.length }} worlds" = interpolation + text

      const span = await classifyBindings(root, 'src/pages/PlanetsPage.vue', 5, { tag: 'span' })
      expect(span.text.kind).toBe('mixed')
    })

    it('errors read-only when the element is missing or the line is ambiguous', async () => {
      const missing = await classifyBindings(root, 'src/pages/PlanetsPage.vue', 2, { tag: 'PlanetCard' })
      expect(missing.error).toMatch(/not found/)
      expect(missing.props).toEqual([])
      expect(missing.text.kind).toBe('unknown')

      // Two elements on one line without a tag filter → ambiguous.
      await write('src/Two.vue', '<template>\n  <div><span>a</span><span>b</span></div>\n</template>\n')
      const ambiguous = await classifyBindings(root, 'src/Two.vue', 2, { tag: 'span' })
      expect(ambiguous.error).toMatch(/ambiguous/)
    })
  })

  describe('jsx (react + solid)', () => {
    it('classifies literals, expression-literals, negatives, boolean shorthand, and bound props', async () => {
      const r = await classifyBindings(root, 'src/pages/PlanetsPage.tsx', 9, { tag: 'Button' })
      expect(r.analyzer).toBe('jsx')
      expect(r.error).toBeUndefined()
      const byName = Object.fromEntries(r.props.map((p) => [p.name, p]))
      expect(byName.label).toMatchObject({ kind: 'literal', source: 'Reset' })
      expect(byName.count).toMatchObject({ kind: 'literal', source: '3', expression_literal: true })
      expect(byName.negative).toMatchObject({ kind: 'literal', source: '-1', expression_literal: true })
      expect(byName.disabled).toMatchObject({ kind: 'literal', source: 'true', expression_literal: true })
      expect(byName.active.kind).toBe('bound')
      expect(byName.onSelect).toBeUndefined()
    })

    it('detects the enclosing .map() loop', async () => {
      const r = await classifyBindings(root, 'src/pages/PlanetsPage.tsx', 12, { tag: 'PlanetCard' })
      expect(r.error).toBeUndefined()
      expect(r.loop).toMatchObject({ iterable: 'planets', alias: 'planet' })
      const planet = r.props.find((p) => p.name === 'planet')
      expect(planet!.kind).toBe('bound')
    })

    it('marks every prop unknown under {...spread}', async () => {
      const r = await classifyBindings(root, 'src/pages/PlanetsPage.tsx', 15, { tag: 'Chip' })
      const label = r.props.find((p) => p.name === 'label')
      expect(label).toMatchObject({ kind: 'unknown' })
      expect(label!.reason).toMatch(/spread/)
    })

    it('classifies text content', async () => {
      const h1 = await classifyBindings(root, 'src/pages/PlanetsPage.tsx', 7, { tag: 'h1' })
      expect(h1.text).toMatchObject({ kind: 'literal', source: 'Planets' })
      const p = await classifyBindings(root, 'src/pages/PlanetsPage.tsx', 8, { tag: 'p' })
      expect(p.text.kind).toBe('mixed')
    })
  })

  describe('svelte', () => {
    it('classifies attrs and the enclosing {#each} loop', async () => {
      const button = await classifyBindings(root, 'src/pages/PlanetsPage.svelte', 9, { tag: 'Button' })
      expect(button.analyzer).toBe('svelte')
      expect(button.error).toBeUndefined()
      const byName = Object.fromEntries(button.props.map((p) => [p.name, p]))
      expect(byName.label).toMatchObject({ kind: 'literal', source: 'Reset' })
      expect(byName.count).toMatchObject({ kind: 'literal', source: '3', expression_literal: true })
      expect(byName.active.kind).toBe('bound')

      const card = await classifyBindings(root, 'src/pages/PlanetsPage.svelte', 11, { tag: 'PlanetCard' })
      expect(card.error).toBeUndefined()
      expect(card.loop).toMatchObject({ iterable: 'planets', alias: 'planet' })
    })

    it('classifies text content', async () => {
      const h1 = await classifyBindings(root, 'src/pages/PlanetsPage.svelte', 7, { tag: 'h1' })
      expect(h1.text).toMatchObject({ kind: 'literal', source: 'Planets' })
    })
  })

  describe('honesty fallbacks', () => {
    it('treats unsupported file types as wholly read-only', async () => {
      await write('src/page.astro', '<h1>Hello</h1>\n')
      const r = await classifyBindings(root, 'src/page.astro', 1)
      expect(r.analyzer).toBe('none')
      expect(r.error).toMatch(/unsupported/)
      expect(r.text.kind).toBe('unknown')
    })

    it('rejects escaping paths', async () => {
      const r = await classifyBindings(root, '../outside.vue', 1)
      expect(r.error).toMatch(/Invalid|escap/i)
    })

    it('excerpt_hash is stable across calls and changes when the source changes', async () => {
      const a = await classifyBindings(root, 'src/pages/PlanetsPage.vue', 6, { tag: 'Button' })
      clearBindingClassifyCache()
      const b = await classifyBindings(root, 'src/pages/PlanetsPage.vue', 6, { tag: 'Button' })
      expect(a.excerpt_hash).toBe(b.excerpt_hash)

      await write('src/pages/PlanetsPage.vue', PLANETS_PAGE_VUE.replace('label="Reset"', 'label="Clear"'))
      clearBindingClassifyCache()
      const c = await classifyBindings(root, 'src/pages/PlanetsPage.vue', 6, { tag: 'Button' })
      expect(c.excerpt_hash).not.toBe(a.excerpt_hash)
    })
  })
})
