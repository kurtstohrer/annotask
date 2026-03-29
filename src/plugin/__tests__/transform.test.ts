import { describe, it, expect } from 'vitest'
import { transformSFC } from '../transform'

const ROOT = '/project'

function transform(code: string, file = '/project/src/App.vue') {
  return transformSFC(code, file, ROOT)
}

describe('transformSFC', () => {
  it('injects data-annotask-* attributes on elements', () => {
    const code = '<template><div>hello</div></template>'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file="src/App.vue"')
    expect(result).toContain('data-annotask-line=')
    expect(result).toContain('data-annotask-component="App"')
  })

  it('returns null when no template block', () => {
    const code = '<script setup>const x = 1</script>'
    expect(transform(code)).toBeNull()
  })

  it('returns null for empty template', () => {
    const code = '<template></template>'
    expect(transform(code)).toBeNull()
  })

  it('extracts component name from file path', () => {
    const code = '<template><div></div></template>'
    const result = transformSFC(code, '/project/src/components/MyWidget.vue', ROOT)!
    expect(result).toContain('data-annotask-component="MyWidget"')
  })

  it('computes relative file path', () => {
    const code = '<template><div></div></template>'
    const result = transformSFC(code, '/project/src/components/Foo.vue', ROOT)!
    expect(result).toContain('data-annotask-file="src/components/Foo.vue"')
  })

  describe('file-relative line numbers', () => {
    it('produces correct line when template is on line 1', () => {
      const code = '<template>\n<div>hello</div>\n</template>'
      const result = transform(code)!
      // Template opens on line 1, content starts line 1. <div> is on template line 2
      // templateStartLine = 1, lineInTemplate for <div> at offset after \n = 2
      // lineInFile = 1 + 2 - 1 = 2
      expect(result).toContain('data-annotask-line="2"')
    })

    it('accounts for script block above template', () => {
      const code = [
        '<script setup>',
        'const x = 1',
        'const y = 2',
        '</script>',
        '<template>',
        '  <div>hello</div>',
        '</template>',
      ].join('\n')
      const result = transform(code)!
      // <template> tag ends at line 5, content starts on line 5
      // <div> is first element in template content (line 1 within template content after the newline + spaces)
      // templateStartLine = 5 (lines 1-5 up to end of <template> tag)
      // lineInTemplate for <div> = 2 (after one newline in template content)
      // lineInFile = 5 + 2 - 1 = 6
      expect(result).toContain('data-annotask-line="6"')
    })
  })

  describe('tag scanning', () => {
    it('handles self-closing tags', () => {
      const code = '<template><img /><input /></template>'
      const result = transform(code)!
      expect(result).toContain('data-annotask-file')
      // Both tags should be instrumented
      expect(result).toMatch(/img.*data-annotask-file/)
      expect(result).toMatch(/input.*data-annotask-file/)
    })

    it('handles > inside double-quoted attributes', () => {
      const code = '<template><div :class="{ hot: x > 100 }">text</div></template>'
      const result = transform(code)!
      expect(result).toContain('data-annotask-file')
      // The tag should not be prematurely closed
      expect(result).toContain(':class="{ hot: x > 100 }"')
    })

    it('handles > inside single-quoted attributes', () => {
      const code = "<template><div :class='{ hot: x > 100 }'>text</div></template>"
      const result = transform(code)!
      expect(result).toContain('data-annotask-file')
    })

    it('handles backtick template literals', () => {
      const code = '<template><div :class="`item-${count > 5 ? \'a\' : \'b\'}`">text</div></template>'
      const result = transform(code)!
      expect(result).toContain('data-annotask-file')
      // The tag should not be broken by > inside backtick expression
      expect(result).toContain('data-annotask-component')
    })
  })

  describe('skipped elements', () => {
    it('skips script tags', () => {
      const code = '<template><script>var x = 1</script><div>hello</div></template>'
      const result = transform(code)!
      // Only div should have attributes, not the inner script
      const matches = result.match(/data-annotask-file/g)
      expect(matches).toHaveLength(1)
    })

    it('skips style tags', () => {
      const code = '<template><style>.x {}</style><div>hello</div></template>'
      const result = transform(code)!
      const matches = result.match(/data-annotask-file/g)
      expect(matches).toHaveLength(1)
    })

    it('skips slot tags', () => {
      const code = '<template><slot></slot><div>hello</div></template>'
      const result = transform(code)!
      const matches = result.match(/data-annotask-file/g)
      expect(matches).toHaveLength(1)
    })
  })

  it('skips HTML comments', () => {
    const code = '<template><!-- comment --><div>hello</div></template>'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
    expect(result).toContain('<!-- comment -->')
  })

  it('skips already-instrumented elements', () => {
    const code = '<template><div data-annotask-file="x">hello</div></template>'
    // Already instrumented, should not double-inject
    expect(transform(code)).toBeNull()
  })

  it('handles multiple elements', () => {
    const code = '<template><div><span>a</span><p>b</p></div></template>'
    const result = transform(code)!
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(3) // div, span, p
  })

  it('handles closing tags correctly', () => {
    const code = '<template><div></div></template>'
    const result = transform(code)!
    // Should not inject into closing tag
    expect(result).not.toContain('</div data-annotask')
  })
})
