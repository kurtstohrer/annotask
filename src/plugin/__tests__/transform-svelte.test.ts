import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'svelte/compiler'
import { transformFile, transformSvelte } from '../transform'

const ROOT = '/project'

function transform(code: string, file = '/project/src/Counter.svelte') {
  return transformSvelte(code, file, ROOT)
}

/** Assert the transformed source still compiles under the real Svelte compiler. */
function expectCompiles(source: string) {
  expect(() => compile(source, { generate: 'client', filename: 'Test.svelte' })).not.toThrow()
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

  // Regression: findTagEnd must track {} brace depth in Svelte markup —
  // attribute expressions like `onclick={() => ...}` contain bare `>` that
  // would otherwise terminate the tag early and inject attributes INSIDE
  // the expression (svelte/compiler js_parse_error).
  describe('attribute expressions (brace tracking)', () => {
    it('handles on:click={() => fn(null)} (Svelte 4 events)', () => {
      const code = [
        '<script>',
        '  function fn(v) { console.log(v) }',
        '</script>',
        '<button on:click={() => fn(null)}>go</button>',
      ].join('\n')
      const result = transform(code)!
      // Expression intact, injection landed on the tag — never inside braces
      expect(result).toContain('on:click={() => fn(null)}')
      expect(result).not.toMatch(/\{[^}]*data-annotask/)
      expect(result).toMatch(/<button on:click=\{\(\) => fn\(null\)\} data-annotask-file/)
      expectCompiles(result)
    })

    it('handles onclick={() => fn(1)} (Svelte 5 events)', () => {
      const code = [
        '<script>',
        '  function fn(v) { console.log(v) }',
        '</script>',
        '<button onclick={() => fn(1)}>go</button>',
      ].join('\n')
      const result = transform(code)!
      expect(result).toContain('onclick={() => fn(1)}')
      expect(result).not.toMatch(/\{[^}]*data-annotask/)
      expectCompiles(result)
    })

    it('handles bare > comparison in class={a > b}', () => {
      const code = [
        '<script>',
        '  let a = 1',
        '  let b = 2',
        '</script>',
        '<div class={a > b}>x</div>',
      ].join('\n')
      const result = transform(code)!
      expect(result).toContain('class={a > b}')
      expect(result).not.toMatch(/\{[^}]*data-annotask/)
      expectCompiles(result)
    })

    it('handles arrow-function attribute value attr={x => y}', () => {
      const code = [
        '<script>',
        '  let y = 1',
        '</script>',
        '<div data-handler={x => y}>hi</div>',
      ].join('\n')
      const result = transform(code)!
      expect(result).toContain('data-handler={x => y}')
      expect(result).not.toMatch(/\{[^}]*data-annotask/)
      expectCompiles(result)
    })

    it('handles multiline tags with expression attributes and trailing >', () => {
      const code = [
        '<button',
        '  type="button"',
        '  class:active={value === null}',
        '  onclick={() => onselect(null)}',
        '>',
        '  All',
        '</button>',
      ].join('\n')
      const result = transform(code)!
      expect(result).toContain('class:active={value === null}')
      expect(result).toContain('onclick={() => onselect(null)}')
      expect(result).not.toMatch(/\{[^}]*data-annotask/)
    })

    it('transforms the real playground FilterChips.svelte without corruption', () => {
      const playgroundRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../playgrounds/simple/svelte-vite'
      )
      const file = path.join(playgroundRoot, 'src/components/FilterChips.svelte')
      const code = readFileSync(file, 'utf8')
      const result = transformFile(code, file, playgroundRoot)!
      expect(result).toContain('onclick={() => onselect(null)}')
      expect(result).toContain('onclick={() => onselect(option)}')
      expect(result).not.toMatch(/\{[^}]*data-annotask/)
      // Both <button>s and the wrapping <div> get instrumented
      expect(result.match(/data-annotask-file/g)!.length).toBe(3)
      expectCompiles(result)
    })

    it('keeps every playground svelte-vite component compilable after transform', () => {
      // End-to-end net: real-world Svelte 5 sources (snippets, $props,
      // expression attributes, each blocks) must survive the transform.
      const playgroundRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../playgrounds/simple/svelte-vite'
      )
      // Recursive readdir (Node 18.17+/20) — NOT fs.globSync, which is Node 22+
      // and would throw on CI's Node 20.
      const files = readdirSync(path.join(playgroundRoot, 'src'), { recursive: true })
        .map(String)
        .filter((f) => f.endsWith('.svelte'))
        .map((f) => path.join('src', f))
      expect(files.length).toBeGreaterThan(0)
      for (const rel of files) {
        const file = path.join(playgroundRoot, rel)
        const code = readFileSync(file, 'utf8')
        const result = transformFile(code, file, playgroundRoot)
        if (result === null) continue // nothing instrumentable
        expect(
          () => compile(result, { generate: 'client', filename: rel }),
          `${rel} no longer compiles after transform`
        ).not.toThrow()
      }
    })
  })
})
