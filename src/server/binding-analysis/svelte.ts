/**
 * Svelte binding analyzer. Uses `svelte/compiler.parse()` for the AST when
 * available; returns null otherwise (orchestrator falls through to
 * file-level fallback).
 *
 * Covers the common patterns:
 *   <script> let { a, b } = useXxx()          → taints [a, b]
 *   <script> let foo = useXxx()                → taints [foo]
 *   <script> $: derived = foo.x                → one-level reactive alias
 *   template {name}                            → mustache identifier
 *   template {#each planets as planet}         → alias taint inside block
 *   template <ChildComp {planet} />            → prop edge with shorthand
 *   template <ChildComp planet={planet} />     → prop edge with RHS expr
 */
import type { AnalyzeArgs, AnalyzeResult, FrameworkBindingAnalyzer } from './types.js'
import type { BindingSite, PropEdge } from '../../schema.js'

const ID_RE = /[A-Za-z_$][\w$]*/g
const KEYWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'new', 'return', 'typeof',
  'in', 'of', 'instanceof', 'void', 'await', 'async',
])

async function tryLoadCompiler(): Promise<any | null> {
  try {
    // @ts-ignore optional peer dep
    return await import('svelte/compiler')
  } catch { return null }
}

export const svelteAnalyzer: FrameworkBindingAnalyzer = {
  id: 'svelte',
  supports(file: string) { return file.endsWith('.svelte') },
  async analyze(args: AnalyzeArgs): Promise<AnalyzeResult | null> {
    const sv = await tryLoadCompiler()
    if (!sv?.parse) return null

    const seeds = args.seeds ?? []
    if (!args.content.includes(args.source_name) && !seeds.some(s => args.content.includes(s.name))) {
      return null
    }

    let ast: any
    try { ast = sv.parse(args.content) }
    catch { return null }

    const tainted = new Set<string>()
    for (const s of seeds) tainted.add(s.name)

    const scriptBody = extractScriptText(args.content, ast)
    if (scriptBody) {
      seedFromCalls(scriptBody, args.source_name, tainted)
      for (let r = 0; r < 5; r++) {
        const before = tainted.size
        collectAliases(scriptBody, tainted)
        if (tainted.size === before) break
      }
    }

    const sites: BindingSite[] = []
    const edges: PropEdge[] = []

    walkFragment(ast.html ?? ast, tainted, { file: args.file, sites, edges })

    if (sites.length === 0 && edges.length === 0) return null
    return { sites, prop_edges: edges, tainted_symbols: [...tainted] }
  },
}

function extractScriptText(source: string, ast: any): string {
  const instance = ast.instance
  if (!instance) return ''
  const start = instance.content?.start ?? instance.start
  const end = instance.content?.end ?? instance.end
  if (typeof start !== 'number' || typeof end !== 'number') return ''
  return source.slice(start, end)
}

function seedFromCalls(script: string, sourceName: string, tainted: Set<string>): void {
  const destructureRe = new RegExp(`(?:let|const|var)\\s*\\{([^}]+)\\}\\s*=\\s*${escapeRegex(sourceName)}\\s*\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = destructureRe.exec(script)) !== null) {
    for (const id of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      const pair = id.split(':').map(s => s.trim())
      const name = pair[1] || pair[0]
      if (name) tainted.add(name.replace(/^\.\.\./, ''))
    }
  }
  const simpleRe = new RegExp(`(?:let|const|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${escapeRegex(sourceName)}\\s*\\(`, 'g')
  while ((m = simpleRe.exec(script)) !== null) {
    tainted.add(m[1])
  }
}

function collectAliases(script: string, tainted: Set<string>): void {
  const assignRe = /(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n;]+)/g
  let m: RegExpExecArray | null
  while ((m = assignRe.exec(script)) !== null) {
    if (referencesTainted(m[2], tainted)) tainted.add(m[1])
  }
  // `$: derived = foo.x`
  const reactiveRe = /\$\s*:\s*([A-Za-z_$][\w$]*)\s*=\s*([^\n;]+)/g
  while ((m = reactiveRe.exec(script)) !== null) {
    if (referencesTainted(m[2], tainted)) tainted.add(m[1])
  }
}

interface SvelteCtx { file: string; sites: BindingSite[]; edges: PropEdge[] }

function walkFragment(node: any, scope: Set<string>, ctx: SvelteCtx): void {
  if (!node) return
  visit(node, new Set(scope), ctx)
}

function visit(node: any, scope: Set<string>, ctx: SvelteCtx): void {
  if (!node || typeof node !== 'object') return
  const type = node.type
  if (type === 'MustacheTag' || type === 'RawMustacheTag') {
    const expr = node.expression
    const ids = collectIds(expr)
    const hit = ids.filter(id => scope.has(id))
    if (hit.length > 0) {
      ctx.sites.push({ file: ctx.file, line: lineOf(node), tainted_symbols: hit })
    }
    return
  }
  if (type === 'EachBlock') {
    const iterIds = collectIds(node.expression)
    const iterHit = iterIds.filter(id => scope.has(id))
    const childScope = new Set(scope)
    if (iterHit.length > 0) {
      // Mark the each block itself as a site and add the alias to scope.
      ctx.sites.push({ file: ctx.file, line: lineOf(node), tainted_symbols: iterHit })
      const alias = patternIdentifiers(node.context)
      for (const n of alias) childScope.add(n)
    }
    for (const child of (node.children ?? [])) visit(child, childScope, ctx)
    if (node.else) visit(node.else, scope, ctx)
    return
  }
  if (type === 'InlineComponent' || type === 'Element') {
    const tag = node.name as string | undefined
    const isComponent = type === 'InlineComponent' || (tag && /^[A-Z]/.test(tag))
    let elementIsSite = false
    const elSymbols = new Set<string>()

    for (const attr of (node.attributes ?? [])) {
      if (attr.type === 'Attribute' || attr.type === 'Spread' || attr.type === 'Binding') {
        const values = Array.isArray(attr.value) ? attr.value : (attr.value ? [attr.value] : [])
        for (const v of values) {
          if (!v) continue
          if (v.type === 'MustacheTag' || v.type === 'AttributeShorthand') {
            const expr = v.expression
            const ids = collectIds(expr)
            const hit = ids.filter(id => scope.has(id))
            if (hit.length > 0) {
              elementIsSite = true
              hit.forEach(id => elSymbols.add(id))
              if (isComponent && attr.name) {
                ctx.edges.push({
                  from_file: ctx.file,
                  from_line: lineOf(node),
                  to_hint: tag || '',
                  prop_name: attr.name,
                  source_expr: astText(expr),
                })
              }
            }
          }
        }
      }
    }

    if (elementIsSite) {
      ctx.sites.push({ file: ctx.file, line: lineOf(node), tainted_symbols: [...elSymbols] })
    }
    for (const child of (node.children ?? [])) visit(child, scope, ctx)
    return
  }
  // Fragment / root / other
  for (const child of (node.children ?? [])) visit(child, scope, ctx)
  if (node.expression && node.expression.type !== 'Identifier') visit(node.expression, scope, ctx)
}

function patternIdentifiers(pattern: any): string[] {
  const out: string[] = []
  const recurse = (n: any) => {
    if (!n) return
    if (n.type === 'Identifier') { out.push(n.name); return }
    if (n.type === 'ObjectPattern') {
      for (const p of (n.properties ?? [])) recurse(p.value ?? p.key)
      return
    }
    if (n.type === 'ArrayPattern') {
      for (const el of (n.elements ?? [])) recurse(el)
      return
    }
    if (n.type === 'RestElement') recurse(n.argument)
    if (n.type === 'AssignmentPattern') recurse(n.left)
  }
  recurse(pattern)
  return out
}

function collectIds(node: any): string[] {
  if (!node) return []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (name: string) => { if (!seen.has(name)) { seen.add(name); out.push(name) } }
  const rec = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'Identifier' && !KEYWORDS.has(n.name)) push(n.name)
    // MemberExpression: only taint the root object, not property names.
    if (n.type === 'MemberExpression') { rec(n.object); return }
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue
      const v = n[key]
      if (!v) continue
      if (Array.isArray(v)) { for (const x of v) rec(x) }
      else if (typeof v === 'object') rec(v)
    }
  }
  rec(node)
  return out
}

function astText(node: any): string {
  if (!node) return ''
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MemberExpression') return `${astText(node.object)}.${astText(node.property)}`
  return ''
}

function referencesTainted(expr: string, tainted: Set<string>): boolean {
  ID_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ID_RE.exec(expr)) !== null) { if (tainted.has(m[0])) return true }
  return false
}

function lineOf(node: any): number {
  if (node.loc?.start?.line) return node.loc.start.line
  // Svelte 3/4 uses start/end as offsets into the source; loc is sometimes absent.
  return 0
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
