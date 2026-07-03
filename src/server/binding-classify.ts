/**
 * Round-trip honesty classifier — the gate that decides which fields of an
 * element are EDITABLE in the properties panel and which are read-only.
 *
 * Given an element's durable anchor (file, line[, tag]), classify every
 * attribute/prop written at that usage site as literal (editable — a write
 * back to source is exact), bound expression (read-only — "this value comes
 * from `planet.name`"), or unknown (read-only), plus the element's text
 * content and any enclosing loop ("editing one edits all N").
 *
 * AST, not regex: real usage sites span multiple lines (`<PlanetCard
 * v-for=… :planet=… :active=… />`) and `data-annotask-line` points at the
 * opening tag only — a single-line regex can't see continuation-line attrs or
 * the enclosing v-for, and misclassification means editing the wrong thing.
 * The framework compilers are loaded lazily exactly like binding-analysis/
 * (optional peers); when a parser is missing or parsing fails, everything
 * degrades to read-only. PRECISION OVER RECALL — never guess editable.
 */
import fsp from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolveProjectFile } from './path-safety.js'

export interface BindingFieldInfo {
  name: string
  kind: 'literal' | 'bound' | 'unknown'
  /** Literal: the source value. Bound: the expression text, shown verbatim. */
  source: string
  /** Literal written through binding syntax (`:count="3"`, `count={3}`) —
   *  a write back must keep the binding syntax. */
  expression_literal?: boolean
  /** Human-readable read-only reason ('bound expression', 'spread props', …). */
  reason?: string
}

export interface BindingTextInfo {
  /** 'literal' — text nodes only → editable, a textContent swap is exact.
   *  'bound'   — interpolation/expression only → read-only.
   *  'mixed'   — text plus elements/interpolations → read-only.
   *  'none'    — no text children. 'unknown' — could not classify. */
  kind: 'literal' | 'bound' | 'mixed' | 'none' | 'unknown'
  source?: string
  reason?: string
}

export interface BindingClassification {
  file: string
  line: number
  tag?: string
  analyzer: 'vue-sfc' | 'jsx' | 'svelte' | 'none'
  /** Present when the element (or an ancestor) renders in a loop. */
  loop?: { iterable: string; alias?: string }
  props: BindingFieldInfo[]
  text: BindingTextInfo
  /** sha256-16 of the ±5-line excerpt around `line` — drift guard, same idea
   *  as code-context.ts. */
  excerpt_hash: string
  /** Parse failed / element not found / ambiguous → everything read-only. */
  error?: string
}

const EXPRESSION_LITERAL_RE = /^\s*(?:'[^']*'|"[^"]*"|`[^`$\\]*`|-?\d+(?:\.\d+)?|true|false)\s*$/

// ── lazy optional-peer compiler loading (binding-analysis pattern) ──

async function tryLoadVueSfc(): Promise<any | null> {
  try {
    // @ts-ignore optional peer dep
    return await import('@vue/compiler-sfc')
  } catch { return null }
}

async function tryLoadBabelParser(): Promise<any | null> {
  try {
    // @ts-ignore optional peer dep
    return await import('@babel/parser')
  } catch { return null }
}

async function tryLoadSvelte(): Promise<any | null> {
  try {
    // @ts-ignore optional peer dep
    return await import('svelte/compiler')
  } catch { return null }
}

// ── small shared helpers ──

function excerptHash(lines: string[], line: number): string {
  const idx = Math.max(0, Math.min(line - 1, lines.length - 1))
  const start = Math.max(0, idx - 5)
  const end = Math.min(lines.length - 1, idx + 5)
  return createHash('sha256').update(lines.slice(start, end + 1).join('\n')).digest('hex').slice(0, 16)
}

function readOnlyResult(
  base: Pick<BindingClassification, 'file' | 'line' | 'tag' | 'excerpt_hash'>,
  analyzer: BindingClassification['analyzer'],
  error: string,
): BindingClassification {
  return { ...base, analyzer, props: [], text: { kind: 'unknown', reason: error }, error }
}

/** Byte offset → 1-based line, for ASTs that only carry offsets (Svelte). */
function buildOffsetToLine(content: string): (offset: number) => number {
  const starts: number[] = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1)
  }
  return (offset: number) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

function tagMatches(nodeTag: string | undefined, wanted: string | undefined): boolean {
  if (!wanted || !nodeTag) return true
  return nodeTag.toLowerCase() === wanted.toLowerCase()
}

// ── Vue (.vue) ──

const VUE_NODE = { ELEMENT: 1, TEXT: 2, INTERPOLATION: 5, ATTRIBUTE: 6, DIRECTIVE: 7 } as const

interface VueMatch { node: any; ancestors: any[] }

function findVueElements(root: any, line: number, tag: string | undefined, lineOffset: number): VueMatch[] {
  const matches: VueMatch[] = []
  const stack: any[] = []
  function walk(node: any): void {
    if (!node || typeof node !== 'object') return
    if (node.type === VUE_NODE.ELEMENT) {
      const startLine = (node.loc?.start?.line ?? 0) + lineOffset
      if (startLine === line && tagMatches(node.tag, tag)) {
        matches.push({ node, ancestors: [...stack] })
      }
      stack.push(node)
      for (const child of node.children ?? []) walk(child)
      stack.pop()
      return
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  return matches
}

function parseVFor(exp: string): { iterable: string; alias?: string } {
  // "planet in filtered" | "(planet, i) in filtered" | "item of list"
  const m = /^\s*\(?\s*([^,)\s]+)[^)]*?\)?\s+(?:in|of)\s+(.+?)\s*$/.exec(exp)
  if (m) return { iterable: m[2], alias: m[1] }
  return { iterable: exp }
}

function classifyVueElement(match: VueMatch): Pick<BindingClassification, 'props' | 'text' | 'loop'> {
  const { node, ancestors } = match
  const props: BindingFieldInfo[] = []
  let spread = false
  let loop: BindingClassification['loop']

  for (const holder of [...ancestors, node]) {
    if (holder.type !== VUE_NODE.ELEMENT) continue
    for (const p of holder.props ?? []) {
      if (p.type === VUE_NODE.DIRECTIVE && p.name === 'for' && p.exp?.content) {
        loop = parseVFor(String(p.exp.content))
      }
    }
  }

  for (const p of node.props ?? []) {
    if (p.type === VUE_NODE.ATTRIBUTE) {
      props.push({ name: p.name, kind: 'literal', source: p.value?.content ?? '' })
    } else if (p.type === VUE_NODE.DIRECTIVE) {
      if (p.name === 'for' || p.name === 'if' || p.name === 'else-if' || p.name === 'else' || p.name === 'on' || p.name === 'slot') continue
      if (p.name === 'bind') {
        if (!p.arg) { spread = true; continue } // v-bind="obj"
        const name = p.arg.content ? String(p.arg.content) : ''
        const exp = p.exp?.content ? String(p.exp.content) : ''
        if (!name || !p.arg.isStatic) {
          props.push({ name: name || '(dynamic)', kind: 'unknown', source: exp, reason: 'dynamic prop name' })
        } else if (EXPRESSION_LITERAL_RE.test(exp)) {
          props.push({ name, kind: 'literal', source: exp.trim(), expression_literal: true })
        } else {
          props.push({ name, kind: 'bound', source: exp, reason: 'bound expression' })
        }
      } else if (p.name === 'model') {
        const name = p.arg?.content ? String(p.arg.content) : 'modelValue'
        props.push({ name, kind: 'bound', source: p.exp?.content ? String(p.exp.content) : '', reason: 'v-model binding' })
      } else {
        // A directive we don't model (v-html, v-text, v-show, v-once, v-memo,
        // a custom directive, …). Absence here previously read as "no such
        // prop / verified safe" — surface it explicitly instead so a caller
        // can't mistake an unhandled construct for a clean literal/bound read.
        const name = p.arg?.content ? String(p.arg.content) : `v-${p.name}`
        props.push({ name, kind: 'unknown', source: p.exp?.content ? String(p.exp.content) : '', reason: 'unhandled directive' })
      }
    }
  }

  if (spread) {
    return {
      props: props.map((f) => ({ ...f, kind: 'unknown' as const, expression_literal: undefined, reason: 'spread props (v-bind="…") may override' })),
      text: classifyVueText(node),
      loop,
    }
  }
  return { props, text: classifyVueText(node), loop }
}

function classifyVueText(node: any): BindingTextInfo {
  let textRuns = 0
  let interpolations = 0
  let elements = 0
  let literal = ''
  let expr = ''
  for (const child of node.children ?? []) {
    if (child.type === VUE_NODE.TEXT) {
      if (String(child.content).trim() !== '') { textRuns++; literal += String(child.content) }
    } else if (child.type === VUE_NODE.INTERPOLATION) {
      interpolations++
      expr = child.content?.content ? String(child.content.content) : ''
    } else if (child.type === VUE_NODE.ELEMENT) {
      elements++
    }
  }
  if (elements > 0) return textRuns + interpolations > 0 ? { kind: 'mixed', reason: 'mixed content' } : { kind: 'none' }
  if (textRuns > 0 && interpolations > 0) return { kind: 'mixed', reason: 'mixed content' }
  if (interpolations > 0) return { kind: 'bound', source: expr, reason: 'bound expression' }
  if (textRuns > 0) return { kind: 'literal', source: literal }
  return { kind: 'none' }
}

async function classifyVue(content: string, base: Pick<BindingClassification, 'file' | 'line' | 'tag' | 'excerpt_hash'>): Promise<BindingClassification> {
  const sfc = await tryLoadVueSfc()
  if (!sfc) return readOnlyResult(base, 'none', 'Vue compiler not installed')
  let descriptor: any
  try { descriptor = sfc.parse(content).descriptor } catch { return readOnlyResult(base, 'vue-sfc', 'parse failed') }
  const template = descriptor.template
  if (!template?.ast) {
    // compiler-sfc parses the template block AST itself in recent versions;
    // fall back to compiler-dom when absent.
    try {
      // @ts-ignore optional peer dep
      const dom = await import('@vue/compiler-dom')
      const templateStartLine: number = template?.loc?.start?.line ?? 1
      const ast = dom.parse(template?.content ?? '')
      return finishVue(ast, templateStartLine, base)
    } catch { return readOnlyResult(base, 'vue-sfc', 'template parse failed') }
  }
  const templateStartLine: number = template.loc?.start?.line ?? 1
  return finishVue(template.ast, templateStartLine, base)
}

function firstElementLine(node: any): number | null {
  if (!node || typeof node !== 'object') return null
  if (node.type === VUE_NODE.ELEMENT) return node.loc?.start?.line ?? null
  for (const child of node.children ?? []) {
    const line = firstElementLine(child)
    if (line !== null) return line
  }
  return null
}

function finishVue(ast: any, templateStartLine: number, base: Pick<BindingClassification, 'file' | 'line' | 'tag' | 'excerpt_hash'>): BindingClassification {
  // Line-coordinate detection: compiler-sfc's template.ast carries
  // FILE-ABSOLUTE element lines (parsed from the whole SFC — note the ROOT
  // node's loc is unreliable, so probe the first element), while compiler-dom
  // on the extracted block content is BLOCK-RELATIVE and needs the offset.
  const probe = firstElementLine(ast)
  const lineOffset = probe !== null && probe < templateStartLine ? templateStartLine - 1 : 0
  const matches = findVueElements(ast, base.line, base.tag, lineOffset)
  if (matches.length === 0) return readOnlyResult(base, 'vue-sfc', 'element not found at line')
  if (matches.length > 1) return readOnlyResult(base, 'vue-sfc', 'ambiguous: multiple elements at line')
  return { ...base, analyzer: 'vue-sfc', ...classifyVueElement(matches[0]) }
}

// ── JSX (.tsx / .jsx — React and Solid) ──

interface JsxMatch { node: any; ancestors: any[] }

function walkBabel(node: any, visit: (node: any, ancestors: any[]) => void, ancestors: any[] = []): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walkBabel(item, visit, ancestors)
    return
  }
  if (typeof node.type !== 'string') return
  visit(node, ancestors)
  ancestors.push(node)
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue
    const value = (node as Record<string, unknown>)[key]
    if (value && typeof value === 'object') walkBabel(value, visit, ancestors)
  }
  ancestors.pop()
}

function jsxTagName(opening: any): string | undefined {
  const name = opening?.name
  if (!name) return undefined
  if (name.type === 'JSXIdentifier') return name.name
  if (name.type === 'JSXMemberExpression') return `${name.object?.name ?? ''}.${name.property?.name ?? ''}`
  return undefined
}

function classifyJsxElement(content: string, match: JsxMatch): Pick<BindingClassification, 'props' | 'text' | 'loop'> {
  const { node, ancestors } = match
  const props: BindingFieldInfo[] = []
  let spread = false
  let loop: BindingClassification['loop']
  let pendingForEach: string | undefined

  for (const anc of ancestors) {
    if (anc.type === 'CallExpression' && anc.callee?.type === 'MemberExpression'
      && anc.callee.property?.type === 'Identifier' && anc.callee.property.name === 'map') {
      const obj = anc.callee.object
      const iterable = typeof obj?.start === 'number' && typeof obj?.end === 'number'
        ? content.slice(obj.start, obj.end)
        : 'list'
      const cb = anc.arguments?.[0]
      const alias = cb?.params?.[0]?.type === 'Identifier' ? cb.params[0].name : undefined
      loop = { iterable, alias }
    }
    // Solid `<For each={items}>{(item) => <Child … />}</For>`. Previously
    // unhandled entirely — an element inside a Solid `<For>` reported no loop
    // at all, which reads as "verified: renders once." Extract what we can;
    // fall back to an explicit 'unknown' iterable rather than staying silent.
    if (anc.type === 'JSXElement' && jsxTagName(anc.openingElement) === 'For') {
      const eachAttr = (anc.openingElement?.attributes ?? []).find(
        (a: any) => a.type === 'JSXAttribute' && a.name?.name === 'each',
      )
      const eachExpr = eachAttr?.value?.type === 'JSXExpressionContainer' ? eachAttr.value.expression : undefined
      pendingForEach = typeof eachExpr?.start === 'number' && typeof eachExpr?.end === 'number'
        ? content.slice(eachExpr.start, eachExpr.end)
        : 'unknown'
    } else if (pendingForEach !== undefined && anc.type === 'ArrowFunctionExpression') {
      const param = anc.params?.[0]
      const alias = param?.type === 'Identifier' ? param.name : undefined
      loop = { iterable: pendingForEach, alias }
      pendingForEach = undefined
    }
  }

  for (const attr of node.openingElement?.attributes ?? []) {
    if (attr.type === 'JSXSpreadAttribute') { spread = true; continue }
    if (attr.type !== 'JSXAttribute') continue
    const name = attr.name?.name ? String(attr.name.name) : ''
    if (!name) continue
    // Event handlers are not editable props.
    if (/^on[A-Z]/.test(name)) continue
    const v = attr.value
    if (v == null) {
      props.push({ name, kind: 'literal', source: 'true', expression_literal: true })
    } else if (v.type === 'StringLiteral') {
      props.push({ name, kind: 'literal', source: v.value })
    } else if (v.type === 'JSXExpressionContainer') {
      const exp = v.expression
      const raw = typeof exp?.start === 'number' && typeof exp?.end === 'number' ? content.slice(exp.start, exp.end) : ''
      if (exp?.type === 'StringLiteral' || exp?.type === 'NumericLiteral' || exp?.type === 'BooleanLiteral'
        || (exp?.type === 'TemplateLiteral' && (exp.expressions?.length ?? 0) === 0)
        || (exp?.type === 'UnaryExpression' && exp.operator === '-' && exp.argument?.type === 'NumericLiteral')) {
        props.push({ name, kind: 'literal', source: raw, expression_literal: true })
      } else {
        props.push({ name, kind: 'bound', source: raw, reason: 'bound expression' })
      }
    } else {
      props.push({ name, kind: 'unknown', source: '', reason: 'unclassified attribute value' })
    }
  }

  const text = classifyJsxText(content, node)
  if (spread) {
    return {
      props: props.map((f) => ({ ...f, kind: 'unknown' as const, expression_literal: undefined, reason: 'spread props ({...props}) may override' })),
      text,
      loop,
    }
  }
  return { props, text, loop }
}

function classifyJsxText(content: string, node: any): BindingTextInfo {
  let textRuns = 0
  let expressions = 0
  let elements = 0
  let literal = ''
  let expr = ''
  for (const child of node.children ?? []) {
    if (child.type === 'JSXText') {
      if (String(child.value).trim() !== '') { textRuns++; literal += String(child.value) }
    } else if (child.type === 'JSXExpressionContainer') {
      if (child.expression?.type === 'JSXEmptyExpression') continue
      if (child.expression?.type === 'StringLiteral') {
        textRuns++
        literal += child.expression.value
        continue
      }
      expressions++
      expr = typeof child.expression?.start === 'number' ? content.slice(child.expression.start, child.expression.end) : ''
    } else if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
      elements++
    }
  }
  if (elements > 0) return textRuns + expressions > 0 ? { kind: 'mixed', reason: 'mixed content' } : { kind: 'none' }
  if (textRuns > 0 && expressions > 0) return { kind: 'mixed', reason: 'mixed content' }
  if (expressions > 0) return { kind: 'bound', source: expr, reason: 'bound expression' }
  if (textRuns > 0) return { kind: 'literal', source: literal }
  return { kind: 'none' }
}

async function classifyJsx(content: string, base: Pick<BindingClassification, 'file' | 'line' | 'tag' | 'excerpt_hash'>): Promise<BindingClassification> {
  const babel = await tryLoadBabelParser()
  if (!babel) return readOnlyResult(base, 'none', 'Babel parser not installed')
  let ast: any
  try {
    ast = babel.parse(content, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'classProperties', 'decorators-legacy', 'importAssertions', 'topLevelAwait'],
      errorRecovery: true,
    })
  } catch { return readOnlyResult(base, 'jsx', 'parse failed') }

  const matches: JsxMatch[] = []
  walkBabel(ast.program, (node, ancestors) => {
    if (node.type !== 'JSXElement') return
    const startLine = node.openingElement?.loc?.start?.line
    if (startLine !== base.line) return
    if (!tagMatches(jsxTagName(node.openingElement), base.tag)) return
    matches.push({ node, ancestors: [...ancestors] })
  })

  if (matches.length === 0) return readOnlyResult(base, 'jsx', 'element not found at line')
  if (matches.length > 1) return readOnlyResult(base, 'jsx', 'ambiguous: multiple elements at line')
  return { ...base, analyzer: 'jsx', ...classifyJsxElement(content, matches[0]) }
}

// ── Svelte (.svelte) ──

interface SvelteMatch { node: any; ancestors: any[] }

function classifySvelteElement(content: string, match: SvelteMatch): Pick<BindingClassification, 'props' | 'text' | 'loop'> {
  const { node, ancestors } = match
  const props: BindingFieldInfo[] = []
  let spread = false
  let loop: BindingClassification['loop']

  for (const anc of ancestors) {
    if (anc.type === 'EachBlock') {
      const iterable = typeof anc.expression?.start === 'number'
        ? content.slice(anc.expression.start, anc.expression.end)
        : 'list'
      const alias = anc.context?.type === 'Identifier' ? anc.context.name : undefined
      loop = { iterable, alias }
    }
  }

  for (const attr of node.attributes ?? []) {
    if (attr.type === 'Spread') { spread = true; continue }
    if (attr.type === 'EventHandler' || attr.type === 'Binding') {
      if (attr.type === 'Binding') {
        props.push({ name: attr.name, kind: 'bound', source: `bind:${attr.name}`, reason: 'two-way binding' })
      }
      continue
    }
    if (attr.type !== 'Attribute') continue
    const name = String(attr.name)
    const value = attr.value
    if (value === true) {
      props.push({ name, kind: 'literal', source: 'true', expression_literal: true })
      continue
    }
    const parts = Array.isArray(value) ? value : []
    if (parts.length === 1 && parts[0].type === 'Text') {
      props.push({ name, kind: 'literal', source: String(parts[0].data ?? parts[0].raw ?? '') })
    } else if (parts.length === 1 && (parts[0].type === 'MustacheTag' || parts[0].type === 'ExpressionTag')) {
      const exp = parts[0].expression
      const raw = typeof exp?.start === 'number' ? content.slice(exp.start, exp.end) : ''
      if (EXPRESSION_LITERAL_RE.test(raw)) {
        props.push({ name, kind: 'literal', source: raw.trim(), expression_literal: true })
      } else {
        props.push({ name, kind: 'bound', source: raw, reason: 'bound expression' })
      }
    } else if (parts.length > 1) {
      props.push({ name, kind: 'bound', source: '', reason: 'interpolated attribute' })
    } else {
      props.push({ name, kind: 'unknown', source: '', reason: 'unclassified attribute value' })
    }
  }

  const text = classifySvelteText(content, node)
  if (spread) {
    return {
      props: props.map((f) => ({ ...f, kind: 'unknown' as const, expression_literal: undefined, reason: 'spread props ({...props}) may override' })),
      text,
      loop,
    }
  }
  return { props, text, loop }
}

function classifySvelteText(content: string, node: any): BindingTextInfo {
  let textRuns = 0
  let expressions = 0
  let elements = 0
  let literal = ''
  let expr = ''
  for (const child of node.children ?? node.fragment?.nodes ?? []) {
    if (child.type === 'Text') {
      if (String(child.data ?? '').trim() !== '') { textRuns++; literal += String(child.data ?? '') }
    } else if (child.type === 'MustacheTag' || child.type === 'ExpressionTag') {
      expressions++
      expr = typeof child.expression?.start === 'number' ? content.slice(child.expression.start, child.expression.end) : ''
    } else if (child.type === 'Element' || child.type === 'InlineComponent' || child.type === 'Component' || child.type === 'RegularElement') {
      elements++
    }
  }
  if (elements > 0) return textRuns + expressions > 0 ? { kind: 'mixed', reason: 'mixed content' } : { kind: 'none' }
  if (textRuns > 0 && expressions > 0) return { kind: 'mixed', reason: 'mixed content' }
  if (expressions > 0) return { kind: 'bound', source: expr, reason: 'bound expression' }
  if (textRuns > 0) return { kind: 'literal', source: literal }
  return { kind: 'none' }
}

async function classifySvelte(content: string, base: Pick<BindingClassification, 'file' | 'line' | 'tag' | 'excerpt_hash'>): Promise<BindingClassification> {
  const sv = await tryLoadSvelte()
  if (!sv?.parse) return readOnlyResult(base, 'none', 'Svelte compiler not installed')
  let ast: any
  try { ast = sv.parse(content) } catch { return readOnlyResult(base, 'svelte', 'parse failed') }

  const offsetToLine = buildOffsetToLine(content)
  const matches: SvelteMatch[] = []
  const stack: any[] = []
  function walk(node: any): void {
    if (!node || typeof node !== 'object') return
    const isElement = node.type === 'Element' || node.type === 'InlineComponent' || node.type === 'Component' || node.type === 'RegularElement'
    if (isElement && typeof node.start === 'number') {
      if (offsetToLine(node.start) === base.line && tagMatches(node.name, base.tag)) {
        matches.push({ node, ancestors: [...stack] })
      }
    }
    stack.push(node)
    for (const child of node.children ?? node.fragment?.nodes ?? []) walk(child)
    if (node.type === 'EachBlock' && node.else) walk(node.else)
    stack.pop()
  }
  walk(ast.html ?? ast.fragment ?? ast)

  if (matches.length === 0) return readOnlyResult(base, 'svelte', 'element not found at line')
  if (matches.length > 1) return readOnlyResult(base, 'svelte', 'ambiguous: multiple elements at line')
  return { ...base, analyzer: 'svelte', ...classifySvelteElement(content, matches[0]) }
}

// ── cache + entry point ──

const CACHE_CAP = 500
const cache = new Map<string, BindingClassification>()

export async function classifyBindings(
  projectRoot: string,
  relFile: string,
  line: number,
  opts?: { tag?: string; workspaceRoot?: string },
): Promise<BindingClassification> {
  const resolved = resolveProjectFile(projectRoot, relFile, opts?.workspaceRoot)
  if (!resolved) {
    return {
      file: String(relFile), line, tag: opts?.tag, analyzer: 'none',
      props: [], text: { kind: 'unknown', reason: 'invalid path' },
      excerpt_hash: '', error: 'Invalid or escaping file path',
    }
  }
  const { absolutePath: absPath, relative: safeFile } = resolved

  let stat: { mtimeMs: number }
  let content: string
  try {
    stat = await fsp.stat(absPath)
    content = await fsp.readFile(absPath, 'utf-8')
  } catch (err: any) {
    return {
      file: safeFile, line, tag: opts?.tag, analyzer: 'none',
      props: [], text: { kind: 'unknown', reason: 'unreadable file' },
      excerpt_hash: '', error: `Could not read file: ${err?.message ?? 'unknown'}`,
    }
  }

  const key = `${absPath}|${stat.mtimeMs}|${line}|${opts?.tag ?? ''}`
  const hit = cache.get(key)
  if (hit) return hit

  const lines = content.split(/\r?\n/)
  const base = { file: safeFile, line, tag: opts?.tag, excerpt_hash: excerptHash(lines, line) }

  let result: BindingClassification
  if (safeFile.endsWith('.vue')) result = await classifyVue(content, base)
  else if (safeFile.endsWith('.tsx') || safeFile.endsWith('.jsx')) result = await classifyJsx(content, base)
  else if (safeFile.endsWith('.svelte')) result = await classifySvelte(content, base)
  else result = readOnlyResult(base, 'none', 'unsupported file type')

  if (cache.size >= CACHE_CAP) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(key, result)
  return result
}

/** Test hook — drop the (path, mtime, line, tag) cache. */
export function clearBindingClassifyCache(): void {
  cache.clear()
}
