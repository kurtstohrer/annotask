import { describe, it, expect } from 'vitest'
import { transformHTML } from '../transform'

const ROOT = '/project'

function transform(code: string, file = '/project/index.html') {
  return transformHTML(code, file, ROOT)
}

describe('transformHTML', () => {
  it('injects attributes on body elements', () => {
    const code = '<!DOCTYPE html><html><head><title>Test</title></head><body><div>hello</div></body></html>'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file="index.html"')
    expect(result).toContain('data-annotask-component="index"')
    expect(result).toContain('data-annotask-line=')
  })

  it('returns null when no body tag', () => {
    const code = '<html><head><title>Test</title></head></html>'
    expect(transform(code)).toBeNull()
  })

  it('returns null for empty body', () => {
    const code = '<html><head></head><body></body></html>'
    expect(transform(code)).toBeNull()
  })

  it('does not inject on head elements', () => {
    const code = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Test</title></head><body><div>hi</div></body></html>'
    const result = transform(code)!
    // Only the div in body should have attributes, not meta/title in head
    expect(result).toContain('<meta charset="UTF-8">')
    expect(result).not.toMatch(/<meta[^>]*data-annotask/)
    expect(result).not.toMatch(/<title[^>]*data-annotask/)
  })

  it('skips script and style tags in body', () => {
    const code = '<html><head></head><body><div>hi</div><script>var x=1</script><style>.a{}</style></body></html>'
    const result = transform(code)!
    expect(result).not.toMatch(/<script[^>]*data-annotask/)
    expect(result).not.toMatch(/<style[^>]*data-annotask/)
    expect(result).toMatch(/<div[^>]*data-annotask/)
  })

  it('computes correct line numbers', () => {
    const code = [
      '<!DOCTYPE html>',
      '<html>',
      '<head><title>Test</title></head>',
      '<body>',
      '  <header>top</header>',
      '  <main>content</main>',
      '</body>',
      '</html>',
    ].join('\n')
    const result = transform(code)!
    expect(result).toContain('data-annotask-line="5"')
    expect(result).toContain('data-annotask-line="6"')
  })

  it('handles body with attributes', () => {
    const code = '<html><head></head><body class="dark"><div>hi</div></body></html>'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file="index.html"')
  })

  it('extracts component name from file path', () => {
    const result = transformHTML(
      '<html><head></head><body><div>hi</div></body></html>',
      '/project/pages/about.html',
      ROOT,
    )!
    expect(result).toContain('data-annotask-component="about"')
    expect(result).toContain('data-annotask-file="pages/about.html"')
  })

  it('injects on nested elements', () => {
    const code = '<html><head></head><body><div><span>a</span><p>b</p></div></body></html>'
    const result = transform(code)!
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(3) // div, span, p
  })
})
