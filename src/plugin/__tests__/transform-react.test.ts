import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
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

  // Regression: the top-level scanner must be string/comment-aware at
  // statement scope — `const html = "<div>x</div>"` previously got
  // attributes injected INSIDE the string literal (a hard syntax error for
  // double-quoted strings, since the injection itself uses double quotes).
  describe('statement-scope string/comment awareness', () => {
    it('does not inject inside double-quoted string literals', () => {
      const code = [
        'const html = "<div>hello</div>"',
        'export function App() { return <p>hi</p> }',
      ].join('\n')
      const result = transform(code)!
      expect(result).toContain('const html = "<div>hello</div>"')
      expect(result.match(/data-annotask-file/g)).toHaveLength(1) // only <p>
    })

    it('does not inject inside single-quoted strings in a ternary', () => {
      const code = [
        "const label = ready ? '<b>y</b>' : '<i>n</i>'",
        'export function App() { return <main>{label}</main> }',
      ].join('\n')
      const result = transform(code)!
      expect(result).toContain("ready ? '<b>y</b>' : '<i>n</i>'")
      expect(result.match(/data-annotask-file/g)).toHaveLength(1) // only <main>
    })

    it('does not mutate template-literal text', () => {
      const code = [
        'const t = `<section>hi</section>`',
        'export const App = () => <p>hi</p>',
      ].join('\n')
      const result = transform(code)!
      expect(result).toContain('const t = `<section>hi</section>`')
      expect(result.match(/data-annotask-file/g)).toHaveLength(1) // only <p>
    })

    it('still transforms JSX inside template-literal ${} interpolations', () => {
      // A tag inside an interpolation IS legal JSX — only the raw template
      // text around it is opaque.
      const code = 'const out = `<li>raw</li> ${cond ? <span>real</span> : null}`'
      const result = transform(code)!
      expect(result).toContain('`<li>raw</li> ')
      expect(result).toMatch(/<span data-annotask-file/)
      expect(result.match(/data-annotask-file/g)).toHaveLength(1) // span only, not li
    })

    it('handles nested template literals inside interpolations', () => {
      const code = 'const out = `a ${wrap(`<em>inner</em>`)} ${flag ? <b>tag</b> : null} z`'
      const result = transform(code)!
      expect(result).toContain('`<em>inner</em>`')
      expect(result).toMatch(/<b data-annotask-file/)
      expect(result.match(/data-annotask-file/g)).toHaveLength(1)
    })

    it('does not inject inside // and /* */ comments', () => {
      const code = [
        '// <div>line comment</div>',
        '/* <section>block',
        '   comment</section> */',
        'export function App() { return <main>hi</main> }',
      ].join('\n')
      const result = transform(code)!
      expect(result).toContain('// <div>line comment</div>')
      expect(result).toContain('<section>block')
      expect(result.match(/data-annotask-file/g)).toHaveLength(1) // only <main>
    })

    it('does not inject inside JSX expression comments', () => {
      const code = 'function App() { return <div>{/* <b>no</b> */}<span>x</span></div> }'
      const result = transform(code)!
      expect(result).toContain('{/* <b>no</b> */}')
      expect(result.match(/data-annotask-file/g)).toHaveLength(2) // div, span
    })

    it('treats quotes and slashes inside JSX children as plain text', () => {
      // String skipping must only apply at statement scope — apostrophes in
      // JSX text are NOT string delimiters.
      const code = 'function App() { return <div>it\'s "quoted" 1/2 <em>fine</em></div> }'
      const result = transform(code)!
      expect(result).toContain('it\'s "quoted" 1/2')
      expect(result.match(/data-annotask-file/g)).toHaveLength(2) // div, em
    })

    it('does not inject inside regex literals', () => {
      const code = [
        'const re = /<div>/',
        'const ratio = total / 2 / count',
        'export function App() { return <p>ok</p> }',
      ].join('\n')
      const result = transform(code)!
      expect(result).toContain('const re = /<div>/')
      expect(result).toContain('total / 2 / count')
      expect(result.match(/data-annotask-file/g)).toHaveLength(1) // only <p>
    })

    it('still transforms JSX after a string-bearing statement', () => {
      const code = [
        'const greeting = "hello <name>"',
        'function App() {',
        '  const cls = `theme-${mode}`',
        '  return <div className={cls}>{greeting}</div>',
        '}',
      ].join('\n')
      const result = transform(code)!
      expect(result).toContain('const greeting = "hello <name>"')
      expect(result).toContain('`theme-${mode}`')
      expect(result.match(/data-annotask-file/g)).toHaveLength(1) // the div
    })

    it('keeps every playground react-vite source syntactically valid after transform', () => {
      // End-to-end net: real-world TSX (template literals, comments, string
      // constants, generics) must survive the transform without syntax errors.
      const playgroundRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../playgrounds/simple/react-vite'
      )
      // Recursive readdir (Node 18.17+/20) — NOT fs.globSync, which is Node 22+
      // and would throw on CI's Node 20.
      const files = readdirSync(path.join(playgroundRoot, 'src'), { recursive: true })
        .map(String)
        .filter((f) => f.endsWith('.tsx') || f.endsWith('.jsx'))
        .map((f) => path.join('src', f))
      expect(files.length).toBeGreaterThan(0)
      for (const rel of files) {
        const file = path.join(playgroundRoot, rel)
        const code = readFileSync(file, 'utf8')
        const result = transformJSX(code, file, playgroundRoot)
        if (result === null) continue // nothing instrumentable
        const sourceFile = ts.createSourceFile(rel, result, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        // parseDiagnostics is internal but stable — the documented alternative
        // (full ts.createProgram) is far heavier for a pure syntax check.
        const diags = (sourceFile as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics
        expect(
          diags.map(d => `${rel}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`),
        ).toEqual([])
      }
    })
  })
})
