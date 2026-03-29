import { describe, it, expect } from 'vitest'
import { transformSvelte } from '../transform'

const ROOT = '/project'

function transform(code: string, file = '/project/src/Counter.svelte') {
  return transformSvelte(code, file, ROOT)
}

describe('transformSvelte', () => {
  it('injects attributes on markup elements', () => {
    const code = '<div>hello</div>'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file="src/Counter.svelte"')
    expect(result).toContain('data-annotask-component="Counter"')
    expect(result).toContain('data-annotask-line="1"')
  })

  it('handles script + markup', () => {
    const code = [
      '<script>',
      '  let count = 0',
      '</script>',
      '',
      '<div>count is {count}</div>',
    ].join('\n')
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
    // Script block should be unchanged
    expect(result).toContain('<script>\n  let count = 0\n</script>')
    // Only the div should have attributes
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(1)
  })

  it('handles script + markup + style', () => {
    const code = [
      '<script>',
      '  let x = 1',
      '</script>',
      '',
      '<div class="container">',
      '  <span>hello</span>',
      '</div>',
      '',
      '<style>',
      '  .container { color: red }',
      '</style>',
    ].join('\n')
    const result = transform(code)!
    // Both div and span should have attributes
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(2)
    // Script and style blocks unchanged
    expect(result).toContain('<script>\n  let x = 1\n</script>')
    expect(result).toContain('<style>\n  .container { color: red }\n</style>')
  })

  it('handles markup before script', () => {
    const code = [
      '<h1>Title</h1>',
      '',
      '<script>',
      '  export let title',
      '</script>',
    ].join('\n')
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(1)
  })

  it('handles markup between and after blocks', () => {
    const code = [
      '<script>let x = 1</script>',
      '<div>between</div>',
      '<style>.x{}</style>',
      '<p>after</p>',
    ].join('\n')
    const result = transform(code)!
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(2) // div and p
  })

  it('passes through Svelte block syntax unchanged', () => {
    const code = [
      '{#if show}',
      '  <div>visible</div>',
      '{:else}',
      '  <span>hidden</span>',
      '{/if}',
    ].join('\n')
    const result = transform(code)!
    expect(result).toContain('{#if show}')
    expect(result).toContain('{:else}')
    expect(result).toContain('{/if}')
    // Both elements should have attributes
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(2)
  })

  it('passes through Svelte each blocks', () => {
    const code = [
      '{#each items as item}',
      '  <li>{item}</li>',
      '{/each}',
    ].join('\n')
    const result = transform(code)!
    expect(result).toContain('{#each items as item}')
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(1)
  })

  it('skips svelte: special elements', () => {
    const code = [
      '<svelte:head><title>App</title></svelte:head>',
      '<div>content</div>',
    ].join('\n')
    const result = transform(code)!
    // title inside svelte:head might get instrumented (it's not in skip list)
    // but svelte:head itself should NOT
    expect(result).not.toMatch(/svelte:head[^>]*data-annotask/)
    // div should have attributes
    expect(result).toContain('<div data-annotask-file')
  })

  it('returns null for markup-only whitespace', () => {
    const code = '<script>let x = 1</script>\n\n<style>.x{}</style>'
    expect(transform(code)).toBeNull()
  })

  it('returns null when no elements exist', () => {
    const code = 'just some text {variable}'
    expect(transform(code)).toBeNull()
  })

  it('computes correct line numbers with script block above', () => {
    const code = [
      '<script>',      // line 1
      '  let x = 1',   // line 2
      '</script>',     // line 3
      '',              // line 4
      '<div>hello</div>', // line 5
    ].join('\n')
    const result = transform(code)!
    expect(result).toContain('data-annotask-line="5"')
  })

  it('handles script context="module"', () => {
    const code = [
      '<script context="module">',
      '  export const prerender = true',
      '</script>',
      '<script>',
      '  let x = 1',
      '</script>',
      '<div>content</div>',
    ].join('\n')
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
    // Both script blocks should be unchanged
    expect(result).toContain('export const prerender = true')
    expect(result).toContain('let x = 1')
  })

  it('handles self-closing tags', () => {
    const code = '<img src="photo.jpg" />'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
    expect(result).toContain('src="photo.jpg"')
  })

  it('extracts component name from filename', () => {
    const result = transformSvelte(
      '<div>test</div>',
      '/project/src/lib/MyComponent.svelte',
      ROOT
    )!
    expect(result).toContain('data-annotask-component="MyComponent"')
  })
})
