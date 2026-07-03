import { describe, it, expect } from 'vitest'
import { fragmentUrlContext } from '../useTaskWorkflows'

describe('fragmentUrlContext', () => {
  it('emits fragment_url when the element has no file', () => {
    expect(fragmentUrlContext('', 'POST /search')).toEqual({ fragment_url: 'POST /search' })
    expect(fragmentUrlContext(undefined, 'GET /rows')).toEqual({ fragment_url: 'GET /rows' })
  })

  it('a real file anchor wins — no fragment_url alongside a file', () => {
    expect(fragmentUrlContext('src/App.vue', 'POST /search')).toEqual({})
  })

  it('empty when there is no fragment provenance', () => {
    expect(fragmentUrlContext('', '')).toEqual({})
    expect(fragmentUrlContext('', undefined)).toEqual({})
  })

  it('spreads to nothing so context stays clean on the happy (file-anchored) path', () => {
    const context = { element_tag: 'li', ...fragmentUrlContext('src/App.vue', 'POST /search') }
    expect(Object.keys(context)).toEqual(['element_tag'])
  })
})
