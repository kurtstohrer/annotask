import { describe, it, expect } from 'vitest'
import { enrichComponentRef, enrichContextComponentRefs } from '../component-context'
import type { ComponentCatalog } from '../component-scanner'

function makeCatalog(): ComponentCatalog {
  return {
    scannedAt: Date.now(),
    libraries: [
      {
        name: '@acme/ui',
        version: '1.0.0',
        components: [
          {
            name: 'Button',
            module: '@acme/ui/button',
            description: null,
            category: 'form',
            tags: ['button'],
            deprecated: false,
            props: [],
            slots: [],
            events: [],
            sourceFile: null,
          },
          {
            name: 'Card',
            module: '@acme/ui/card',
            description: null,
            category: 'layout',
            tags: [],
            deprecated: false,
            props: [],
            slots: [],
            events: [],
            sourceFile: null,
          },
        ],
      },
    ],
  }
}

describe('enrichComponentRef', () => {
  it('fills library and category on a ref matched in the catalog', () => {
    const out = enrichComponentRef({ name: 'Button', file: 'src/pages/Home.vue', line: 12 }, makeCatalog())
    expect(out?.library).toBe('@acme/ui')
    expect(out?.category).toBe('form')
    expect(out?.file).toBe('src/pages/Home.vue')
  })

  it('passes an unknown component through unchanged', () => {
    const out = enrichComponentRef({ name: 'MyLocalThing', file: 'src/pages/My.vue' }, makeCatalog())
    expect(out?.library).toBeUndefined()
    expect(out?.name).toBe('MyLocalThing')
  })

  it('preserves an existing library value', () => {
    const out = enrichComponentRef({ name: 'Button', library: 'original' }, makeCatalog())
    expect(out?.library).toBe('original')
  })
})

describe('enrichContextComponentRefs', () => {
  it('enriches context.component and leaves rendered HTML untouched', () => {
    const ctx: Record<string, unknown> = {
      element_tag: 'button',
      component: { name: 'Button', file: 'src/pages/Home.vue' },
      rendered: '<button class="rt-Btn">Save</button>',
    }
    const out = enrichContextComponentRefs(ctx, makeCatalog()) as Record<string, any>
    expect(out.component.library).toBe('@acme/ui')
    expect(out.component.category).toBe('form')
    expect(out.rendered).toBe('<button class="rt-Btn">Save</button>')
    expect(out.element_tag).toBe('button')
  })

  it('also enriches to_component (arrow variant)', () => {
    const ctx: Record<string, unknown> = {
      component: { name: 'Button' },
      to_component: { name: 'Card' },
    }
    const out = enrichContextComponentRefs(ctx, makeCatalog()) as Record<string, any>
    expect(out.component.library).toBe('@acme/ui')
    expect(out.to_component.library).toBe('@acme/ui')
  })

  it('returns context unchanged when no component refs are present', () => {
    const ctx = { element_tag: 'button', element_classes: 'foo' }
    const out = enrichContextComponentRefs(ctx, makeCatalog())
    expect(out).toEqual(ctx)
  })

  it('returns undefined inputs unchanged', () => {
    expect(enrichContextComponentRefs(undefined, makeCatalog())).toBeUndefined()
  })
})
