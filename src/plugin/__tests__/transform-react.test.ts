import { describe, it, expect } from 'vitest'
import { transformJSX } from '../transform'

const ROOT = '/project'

function transform(code: string, file = '/project/src/App.tsx') {
  return transformJSX(code, file, ROOT)
}

describe('transformJSX', () => {
  it('injects attributes on JSX elements', () => {
    const code = 'export default function App() { return <div>hello</div> }'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file="src/App.tsx"')
    expect(result).toContain('data-annotask-component="App"')
  })

  it('handles multiple elements', () => {
    const code = [
      'function App() {',
      '  return (',
      '    <div>',
      '      <span>hello</span>',
      '      <p>world</p>',
      '    </div>',
      '  )',
      '}',
    ].join('\n')
    const result = transform(code)!
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(3) // div, span, p
  })

  it('handles expression attributes with braces', () => {
    const code = '<div style={{ color: "red" }}>text</div>'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
    expect(result).toContain('style={{ color: "red" }}')
  })

  it('handles > inside brace expressions', () => {
    const code = '<div className={x > 5 ? "big" : "small"}>text</div>'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
    // The tag should not be prematurely closed at the > in x > 5
    expect(result).toContain('className={x > 5 ? "big" : "small"}')
  })

  it('handles nested brace expressions', () => {
    const code = '<div style={{ fontSize: items.filter(x => x > 3).length + "px" }}>text</div>'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
  })

  it('handles self-closing JSX tags', () => {
    const code = '<Component prop="value" />'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
    expect(result).toContain('prop="value"')
  })

  it('handles PascalCase component tags', () => {
    const code = '<MyComponent onClick={handler}>content</MyComponent>'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
  })

  it('skips React fragments (<>)', () => {
    // Fragments start with < followed by >, not <[a-zA-Z]
    const code = [
      'function App() {',
      '  return (',
      '    <>',
      '      <div>hello</div>',
      '    </>',
      '  )',
      '}',
    ].join('\n')
    const result = transform(code)!
    // Only div should have attributes, not the fragment
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(1)
  })

  it('skips TypeScript generic types - Array', () => {
    const code = [
      'const items: Array<string> = []',
      'return <div>hello</div>',
    ].join('\n')
    const result = transform(code)!
    // Only div should have attributes, not Array<string>
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(1)
    // Array<string> should be unchanged
    expect(result).toContain('Array<string>')
  })

  it('skips TypeScript generic types - Promise', () => {
    const code = [
      'async function load(): Promise<Data> {',
      '  return <div>loaded</div>',
      '}',
    ].join('\n')
    const result = transform(code)!
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(1)
    expect(result).toContain('Promise<Data>')
  })

  it('skips TypeScript generic types - Record', () => {
    const code = [
      'const map: Record<string, number> = {}',
      'return <div>hello</div>',
    ].join('\n')
    const result = transform(code)!
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(1)
    expect(result).toContain('Record<string, number>')
  })

  it('skips type annotations with :', () => {
    const code = [
      'const x: CustomType<Props> = {}',
      'return <div>hello</div>',
    ].join('\n')
    const result = transform(code)!
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(1)
  })

  it('skips extends in type context', () => {
    const code = [
      'interface Foo extends Bar<Baz> {}',
      'function App() { return <div>hello</div> }',
    ].join('\n')
    const result = transform(code)!
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(1)
  })

  it('skips as type assertion', () => {
    const code = [
      'const x = value as MyType<string>',
      'return <div>hello</div>',
    ].join('\n')
    const result = transform(code)!
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(1)
  })

  it('handles .jsx files', () => {
    const result = transformJSX(
      '<div>hello</div>',
      '/project/src/App.jsx',
      ROOT
    )!
    expect(result).toContain('data-annotask-component="App"')
  })

  it('computes correct line numbers', () => {
    const code = [
      'import React from "react"',  // line 1
      '',                             // line 2
      'function App() {',             // line 3
      '  return <div>hello</div>',    // line 4
      '}',                            // line 5
    ].join('\n')
    const result = transform(code)!
    expect(result).toContain('data-annotask-line="4"')
  })

  it('returns null for files with no JSX', () => {
    const code = [
      'export const PI = 3.14',
      'export function add(a: number, b: number) { return a + b }',
    ].join('\n')
    expect(transform(code)).toBeNull()
  })

  it('handles closing JSX tags correctly', () => {
    const code = '<div></div>'
    const result = transform(code)!
    expect(result).not.toContain('</div data-annotask')
  })

  it('handles JSX with spread attributes', () => {
    const code = '<div {...props} className="test">content</div>'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
    expect(result).toContain('{...props}')
  })

  it('handles JSX with callback containing >', () => {
    const code = '<button onClick={() => { if (count > 0) setCount(count - 1) }}>decrement</button>'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
  })

  it('handles JSX expression with template literal containing ${} substitutions', () => {
    // Regression: backtick inside a JSX `{...}` expression must save/restore
    // braceDepth so the closing backtick is recognized.
    const code = [
      'function App() {',
      '  const isOpen = true',
      '  return (',
      '    <li className={`${styles.item} ${isOpen ? styles.itemOpen : \'\'}`}>',
      '      <span>hi</span>',
      '    </li>',
      '  )',
      '}',
    ].join('\n')
    const result = transform(code)!
    const matches = result.match(/data-annotask-file/g)
    expect(matches).toHaveLength(2) // li, span
    expect(result).toContain('${styles.item}')
    expect(result).toContain('${isOpen ? styles.itemOpen')
  })

  it('handles nested template literal inside JSX expression', () => {
    const code = '<div title={`outer ${`inner ${x}`} end`}>hi</div>'
    const result = transform(code)!
    expect(result).toContain('data-annotask-file')
    expect(result).toContain('`outer ${`inner ${x}`} end`')
  })

  it('handles multiple components in one file', () => {
    const code = [
      'function Header() { return <header>head</header> }',
      'function Footer() { return <footer>foot</footer> }',
      'function App() { return <div><Header /><Footer /></div> }',
    ].join('\n')
    const result = transform(code)!
    // header, footer, div, Header (self-closing), Footer (self-closing)
    const matches = result.match(/data-annotask-file/g)
    expect(matches!.length).toBeGreaterThanOrEqual(5)
  })
})
