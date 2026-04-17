import { describe, expect, it } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { __testInternals__ as S } from '../../src/server/component-scanner'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => path.join(here, 'fixtures', name)

describe('extractPropsFromDts — regex path', () => {
  it('extracts simple single-line props with JSDoc defaults', async () => {
    const { props } = await S.extractPropsFromDts(fixture('tricky-interface.d.ts'), 'Base')
    const id = props.find(p => p.name === 'id')
    expect(id).toBeDefined()
    expect(id?.type).toBe('string | null')
    expect(id?.required).toBe(false)
    expect(id?.default).toBe('null')
    expect(id?.description).toBe('Unique element id.')
  })

  it('drops PassThrough-internal props via the skip list', async () => {
    const { props } = await S.extractPropsFromDts(fixture('tricky-interface.d.ts'), 'DataTable')
    expect(props.find(p => p.name === 'pt')).toBeUndefined()
  })
})

describe('extractPropsFromDts — flat barrel .d.ts (issue #24)', () => {
  it('extracts props from bare `interface` (no `export`)', async () => {
    const { props } = await S.extractPropsFromDts(fixture('flat-barrel.d.ts'), 'Accordion')
    // Should resolve AccordionProps specifically, not pick the first *Props blindly.
    expect(props.map(p => p.name).sort()).toEqual(['children', 'className', 'expanded'])
    const expanded = props.find(p => p.name === 'expanded')
    expect(expanded?.required).toBe(false)
    expect(expanded?.description).toBe('Should the accordion be expanded?')
  })

  it('resolves per-component props in a file with many *Props interfaces', async () => {
    const { props: groupProps } = await S.extractPropsFromDts(fixture('flat-barrel.d.ts'), 'AccordionGroup', { exactMatchOnly: true })
    expect(groupProps.map(p => p.name).sort()).toEqual(['children', 'className', 'fullWidth', 'multiselect', 'onToggle'])
    const multi = groupProps.find(p => p.name === 'multiselect')
    expect(multi?.default).toBe('false')
  })

  it('exactMatchOnly returns empty when no matching interface exists', async () => {
    const { props } = await S.extractPropsFromDts(fixture('flat-barrel.d.ts'), 'Nonexistent', { exactMatchOnly: true })
    expect(props).toEqual([])
  })
})

describe('extractPropsFromDtsViaTs — AST fallback', () => {
  it('handles multi-line prop types the regex extractor can\'t', async () => {
    const { props, resolvedName } = await S.extractPropsFromDtsViaTs(fixture('tricky-interface.d.ts'), 'DataTable')
    expect(resolvedName).toBe(null) // exact *Props name matched, no rename
    const rows = props.find(p => p.name === 'rows')
    expect(rows).toBeDefined()
    // The AST path preserves the nested object body intact (regex would return zero props here).
    expect(rows?.type).toMatch(/Array/)
    expect(rows?.type).toContain('key: string')
    expect(rows?.type).toContain('value: T')
  })

  it('follows extends chains to inherit parent-interface props', async () => {
    const { props } = await S.extractPropsFromDtsViaTs(fixture('tricky-interface.d.ts'), 'DataTable')
    expect(props.find(p => p.name === 'id')).toBeDefined()   // from BaseProps
    expect(props.find(p => p.name === 'class')).toBeDefined() // from BaseProps
  })

  it('marks required props correctly', async () => {
    const { props } = await S.extractPropsFromDtsViaTs(fixture('tricky-interface.d.ts'), 'DataTable')
    const columns = props.find(p => p.name === 'columns')
    expect(columns?.required).toBe(true)
  })
})

describe('Vue SFC extractors', () => {
  it('extracts slots including scoped-slot flag', async () => {
    const content = await fsp.readFile(fixture('BaseButton.vue'), 'utf-8')
    const slots = S.extractSlotsFromVueContent(content)
    expect(slots.map(s => s.name).sort()).toEqual(['default', 'icon', 'trailing'])
    const icon = slots.find(s => s.name === 'icon')!
    expect(icon.scoped).toBe(true) // has :severity binding
    const trailing = slots.find(s => s.name === 'trailing')!
    expect(trailing.scoped).toBe(false)
  })

  it('extracts emits declared via defineEmits<tuple>() including hyphenated names', () => {
    const content = `<script setup lang="ts">
const emit = defineEmits<{
  click: [event: MouseEvent]
  'focus-change': [focused: boolean]
}>()
</script>`
    const events = S.extractEventsFromVueContent(content)
    expect(events.map(e => e.name).sort()).toEqual(['click', 'focus-change'])
  })

  it('extracts emits from array form', () => {
    const content = `<script setup>defineEmits(['submit', 'cancel'])</script>`
    const events = S.extractEventsFromVueContent(content)
    expect(events.map(e => e.name).sort()).toEqual(['cancel', 'submit'])
  })
})

describe('Component JSDoc description', () => {
  it('returns the first non-tag JSDoc line', () => {
    const content = `
/**
 * My component — does a thing.
 * @since 1.0
 */
export const Foo = {}`
    expect(S.extractComponentJsDoc(content)).toBe('My component — does a thing.')
  })

  it('returns null when no JSDoc block is present', () => {
    expect(S.extractComponentJsDoc('export const Foo = {}')).toBe(null)
  })
})

describe('findVueFile', () => {
  it('returns Base*.vue files (regression: was previously filtered out)', async () => {
    const found = await S.findVueFile(path.join(here, 'fixtures'), 'BaseButton')
    expect(found).not.toBeNull()
    expect(found!.endsWith('BaseButton.vue')).toBe(true)
  })
})

describe('categorizeComponent — heuristic', () => {
  it('maps names/modules to categories', () => {
    expect(S.categorizeComponent('Button', 'primevue/button')).toBe('button')
    expect(S.categorizeComponent('DataTable', 'primevue/datatable')).toBe('data')
    expect(S.categorizeComponent('Dialog', 'primevue/dialog')).toBe('overlay')
    expect(S.categorizeComponent('InputText', 'primevue/inputtext')).toBe('form')
    expect(S.categorizeComponent('ColumnGroup', 'primevue/columngroup')).toBe('layout')
  })

  it('returns null for unmatched names', () => {
    expect(S.categorizeComponent('Whatsit', 'foo/whatsit')).toBe(null)
  })
})

describe('CEM parser — web components', () => {
  it('reads custom-elements.json and extracts class declarations', async () => {
    const components = await S.scanFromCem('my-wc-lib', path.join(here, 'fixtures'))
    expect(components).toHaveLength(1)
    const c = components[0]
    expect(c.name).toBe('MyButton')
    expect(c.module).toBe('my-wc-lib')
    expect(c.description).toBe('A custom-element button.')
  })

  it('merges attributes and public fields, skipping private members', async () => {
    const [c] = await S.scanFromCem('my-wc-lib', path.join(here, 'fixtures'))
    const names = c.props.map(p => p.name).sort()
    expect(names).toEqual(['disabled', 'loading', 'variant'])
    expect(c.props.find(p => p.name === '_internal')).toBeUndefined() // private
    expect(c.props.find(p => p.name === 'variant')?.type).toBe("'primary' | 'secondary' | 'ghost'")
    expect(c.props.find(p => p.name === 'variant')?.default).toBe("'primary'")
  })

  it('extracts slots and events from the manifest', async () => {
    const [c] = await S.scanFromCem('my-wc-lib', path.join(here, 'fixtures'))
    expect(c.slots.map(s => s.name).sort()).toEqual(['default', 'icon'])
    // Empty string slot name → "default" (normalized)
    expect(c.slots.find(s => s.name === 'default')?.description).toBe('Default slot.')
    expect(c.events.map(e => e.name).sort()).toEqual(['change', 'click'])
    const change = c.events.find(e => e.name === 'change')!
    expect(change.payloadType).toBe('CustomEvent<{ value: string }>')
  })
})
