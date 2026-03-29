import { describe, it, expect } from 'vitest'
import { transformAstro } from '../transform'

const ROOT = '/project'

function transform(code: string, file = '/project/src/components/Card.astro') {
  return transformAstro(code, file, ROOT)
}

describe('transformAstro', () => {
  it('injects attributes on markup elements', () => {
    const code = [
      '---',
      'const title = "Hello"',
      '---',
      '',
      '<div>{title}</div>',
    ].join('\n')
    const result = transform(code)!
    expect(result).toContain('data-annotask-file="src/components/Card.astro"')
    expect(result).toContain('data-annotask-component="Card"')
    expect(result).toContain('data-annotask-line=')
  })

  it('preserves frontmatter block', () => {
    const code = [
      '---',
      'const x = 1',
      '---',
      '<div>hi</div>',
    ].join('\n')
    const result = transform(code)!
    expect(result).toContain('---\nconst x = 1\n---')
  })

  it('returns null when no markup', () => {
    const code = [
      '---',
      'const x = 1',
      '---',
    ].join('\n')
    expect(transform(code)).toBeNull()
  })

  it('skips script and style blocks', () => {
    const code = [
      '---',
      'const x = 1',
      '---',
      '',
      '<div>content</div>',
      '',
      '<style>',
      '  .div { color: red; }',
      '</style>',
    ].join('\n')
    const result = transform(code)!
    expect(result).not.toMatch(/<style[^>]*data-annotask/)
    expect(result).toMatch(/<div[^>]*data-annotask/)
    // Style block should be preserved
    expect(result).toContain('<style>\n  .div { color: red; }\n</style>')
  })

  it('computes correct line numbers', () => {
    const code = [
      '---',                  // 1
      'const x = 1',          // 2
      '---',                  // 3
      '',                     // 4
      '<div>',                // 5
      '  <span>hi</span>',   // 6
      '</div>',               // 7
    ].join('\n')
    const result = transform(code)!
    expect(result).toContain('data-annotask-line="5"')
    expect(result).toContain('data-annotask-line="6"')
  })

  it('handles JSX-like expressions', () => {
    const code = [
      '---',
      'const items = ["a", "b"]',
      '---',
      '',
      '<ul>',
      '  {items.map(i => <li>{i}</li>)}',
      '</ul>',
    ].join('\n')
    const result = transform(code)!
    // Both ul and li should have attributes
    expect(result).toMatch(/<ul[^>]*data-annotask/)
    expect(result).toMatch(/<li[^>]*data-annotask/)
  })

  it('handles file without frontmatter', () => {
    const code = '<div><span>hello</span></div>'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(2) // div, span
  })

  it('handles component with only style (no markup)', () => {
    const code = [
      '<style>',
      '  .card { color: red; }',
      '</style>',
    ].join('\n')
    expect(transform(code)).toBeNull()
  })

  it('extracts component name from file path', () => {
    const result = transformAstro(
      '---\n---\n<div>hi</div>',
      '/project/src/pages/index.astro',
      ROOT,
    )!
    expect(result).toContain('data-annotask-component="index"')
    expect(result).toContain('data-annotask-file="src/pages/index.astro"')
  })

  it('handles multiple markup regions between blocks', () => {
    const code = [
      '<header>top</header>',
      '<script>',
      '  console.log("hi")',
      '</script>',
      '<main>content</main>',
    ].join('\n')
    const result = transform(code)!
    expect(result).toMatch(/<header[^>]*data-annotask/)
    expect(result).toMatch(/<main[^>]*data-annotask/)
    expect(result).not.toMatch(/<script[^>]*data-annotask/)
  })
})
