/**
 * Vue SFC binding analyzer.
 *
 * Script pass (regex — Vue scripts are consistent enough that full Babel
 * parsing isn't worth the weight for the patterns we care about):
 *   const { a, b } = useXxx()          → taints [a, b]
 *   const foo = useXxx()                → taints [foo]
 *   const computed = ref(...)           → one-level alias
 *   const derived = computed(() => a…)  → if body references tainted, derived is tainted
 *
 * Template pass (AST via `@vue/compiler-dom`):
 *   - Walks element AST, collects identifiers used in interpolations,
 *     directive exprs, v-bind attrs.
 *   - `v-for="planet in planets"` taints `planet` inside the loop.
 *   - Element is a site iff its expression identifiers intersect the
 *     current tainted set (closest enclosing scope wins).
 *   - `<ChildComp :prop="taintedExpr" />` emits a PropEdge.
 *
 * If `@vue/compiler-sfc` / `@vue/compiler-dom` isn't installed, returns null
 * and the orchestrator falls through to the file-level fallback analyzer.
 */
import type { AnalyzeArgs, AnalyzeResult, FrameworkBindingAnalyzer } from './types.js'
import type { BindingSite, PropEdge } from '../../schema.js'

const ID_RE = /[A-Za-z_$][\w$]*/g

const EXPR_KEYWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'new', 'return', 'typeof',
  'in', 'of', 'instanceof', 'void', 'await', 'async',
  // template-local helpers that are never tainted identifiers
  '$event', '$slots', '$refs', '$attrs',
])

async function tryLoadCompiler(): Promise<any | null> {
  try {
    // Lazy optional-peer import — returns null when Vue isn't installed.
    // @ts-ignore optional peer dep
    return await import('@vue/compiler-sfc')
  } catch { return null }
}

async function tryLoadDomCompiler(): Promise<any | null> {
  try {
    // @ts-ignore optional peer dep
    return await import('@vue/compiler-dom')
  } catch { return null }
}

async function tryLoadBabelParser(): Promise<any | null> {
  try {
    // @ts-ignore optional peer dep
    return await import('@babel/parser')
  } catch { return null }
}

export const vueAnalyzer: FrameworkBindingAnalyzer = {
  id: 'vue-sfc',
  supports(file: string) { return file.endsWith('.vue') },
  async analyze(args: AnalyzeArgs): Promise<AnalyzeResult | null> {
    const sfc = await tryLoadCompiler()
    const dom = await tryLoadDomCompiler()
    if (!sfc || !dom) return null

    let descriptor: any
    try { descriptor = sfc.parse(args.content).descriptor }
    catch { return null }

    const scriptBlock = descriptor.scriptSetup ?? descriptor.script
    const templateBlock = descriptor.template
    if (!templateBlock) return null

    const scriptContent: string = scriptBlock?.content ?? ''
    const scriptStartLine: number = scriptBlock?.loc?.start?.line ?? 1
    const templateStartLine: number = templateBlock.loc?.start?.line ?? 1

    // ── Script: build the tainted symbol set ──
    const tainted = new Set<string>()
    for (const seed of args.seeds ?? []) tainted.add(seed.name)

    // Does this file import / use the source identifier?
    const usesSource = new RegExp(`\\b${escapeRegex(args.source_name)}\\b`).test(scriptContent)
    if (!usesSource && (args.seeds?.length ?? 0) === 0) {
      return null // nothing to trace here
    }

    // Use Babel for the script so multi-line RHS expressions (`const filtered
    // = computed(() => [...planets.value, ...])`) are handled correctly.
    // Falls back to the regex passes when Babel isn't installed.
    const babel = await tryLoadBabelParser()
    if (babel && scriptContent) {
      try {
        const scriptAst = babel.parse(scriptContent, {
          sourceType: 'module',
          plugins: ['typescript', 'classProperties', 'decorators-legacy', 'importAssertions', 'topLevelAwait'],
          allowReturnOutsideFunction: true,
          errorRecovery: true,
        })
        if (usesSource) seedFromBabel(scriptAst, args.source_name, tainted)
        for (let round = 0; round < 5; round++) {
          const before = tainted.size
          aliasesFromBabel(scriptAst, tainted)
          if (tainted.size === before) break
        }
      } catch {
        // Babel failure → fall back to regex-only seeding below.
        if (usesSource) seedFromSourceCalls(scriptContent, args.source_name, tainted)
        for (let round = 0; round < 5; round++) {
          const before = tainted.size
          collectAliases(scriptContent, tainted)
          if (tainted.size === before) break
        }
      }
    } else {
      if (usesSource) seedFromSourceCalls(scriptContent, args.source_name, tainted)
      for (let round = 0; round < 5; round++) {
        const before = tainted.size
        collectAliases(scriptContent, tainted)
        if (tainted.size === before) break
      }
    }

    // ── Template: parse AST ──
    let ast: any
    try { ast = dom.parse(templateBlock.content, { comments: false }) }
    catch { return null }

    const sites: BindingSite[] = []
    const edges: PropEdge[] = []

    walkTemplate(ast, {
      file: args.file,
      templateStartLine,
      tainted: new Set(tainted),
      sites,
      edges,
    })

    if (sites.length === 0 && edges.length === 0) return null
    return { sites, prop_edges: edges, tainted_symbols: [...tainted], note: undefined }
  },
}

function seedFromSourceCalls(script: string, sourceName: string, tainted: Set<string>): void {
  // Object destructure: `const { planets, loading } = usePlanets()`
  const destructureRe = new RegExp(`const\\s*\\{([^}]+)\\}\\s*=\\s*${escapeRegex(sourceName)}\\s*\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = destructureRe.exec(script)) !== null) {
    for (const id of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      // handle renames: `planets: ps`
      const pair = id.split(':').map(s => s.trim())
      const name = pair[1] || pair[0]
      if (name) tainted.add(name.replace(/^\.\.\./, ''))
    }
  }
  // Simple assign: `const foo = usePlanets()`
  const simpleRe = new RegExp(`const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${escapeRegex(sourceName)}\\s*\\(`, 'g')
  while ((m = simpleRe.exec(script)) !== null) {
    tainted.add(m[1])
  }
}

function collectAliases(script: string, tainted: Set<string>): void {
  // `const derived = <expr>` — if expr references a tainted id, taint derived.
  const assignRe = /const\s+(?:\{([^}]+)\}|([A-Za-z_$][\w$]*))\s*=\s*([^\n;]+)/g
  let m: RegExpExecArray | null
  while ((m = assignRe.exec(script)) !== null) {
    const destructured = m[1]
    const single = m[2]
    const rhs = m[3]
    if (!rhs) continue
    if (!referencesTainted(rhs, tainted)) continue
    if (single) tainted.add(single)
    if (destructured) {
      for (const id of destructured.split(',').map(s => s.trim()).filter(Boolean)) {
        const pair = id.split(':').map(s => s.trim())
        const name = pair[1] || pair[0]
        if (name) tainted.add(name.replace(/^\.\.\./, ''))
      }
    }
  }
}

function referencesTainted(expr: string, tainted: Set<string>): boolean {
  ID_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ID_RE.exec(expr)) !== null) {
    if (tainted.has(m[0])) return true
  }
  return false
}

function seedFromBabel(ast: any, sourceName: string, tainted: Set<string>): void {
  walkBabel(ast, (node: any) => {
    if (node.type !== 'VariableDeclarator') return
    const init = node.init
    if (!init) return
    if (init.type === 'CallExpression' && init.callee?.type === 'Identifier' && init.callee.name === sourceName) {
      bindPatternIdentifiers(node.id, tainted)
    }
  })
}

function aliasesFromBabel(ast: any, tainted: Set<string>): void {
  walkBabel(ast, (node: any) => {
    if (node.type !== 'VariableDeclarator') return
    const init = node.init
    if (!init) return
    if (!astReferencesTainted(init, tainted)) return
    bindPatternIdentifiers(node.id, tainted)
  })
}

function bindPatternIdentifiers(pattern: any, target: Set<string>): void {
  if (!pattern) return
  switch (pattern.type) {
    case 'Identifier':
      target.add(pattern.name); break
    case 'ObjectPattern':
      for (const prop of pattern.properties ?? []) {
        if (prop.type === 'RestElement') bindPatternIdentifiers(prop.argument, target)
        else bindPatternIdentifiers(prop.value ?? prop.key, target)
      }
      break
    case 'ArrayPattern':
      for (const el of pattern.elements ?? []) {
        if (!el) continue
        if (el.type === 'RestElement') bindPatternIdentifiers(el.argument, target)
        else bindPatternIdentifiers(el, target)
      }
      break
    case 'AssignmentPattern':
      bindPatternIdentifiers(pattern.left, target); break
    case 'RestElement':
      bindPatternIdentifiers(pattern.argument, target); break
  }
}

function astReferencesTainted(node: any, tainted: Set<string>): boolean {
  let hit = false
  walkBabel(node, (n: any) => {
    if (hit) return
    if (n.type === 'Identifier' && tainted.has(n.name)) hit = true
  })
  return hit
}

function walkBabel(node: any, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'parent' || key === 'leadingComments' || key === 'trailingComments') continue
    const v = (node as any)[key]
    if (!v) continue
    if (Array.isArray(v)) { for (const x of v) walkBabel(x, visit) }
    else if (typeof v === 'object') walkBabel(v, visit)
  }
}

interface WalkCtx {
  file: string
  templateStartLine: number
  tainted: Set<string>
  sites: BindingSite[]
  edges: PropEdge[]
}

function walkTemplate(node: any, ctx: WalkCtx): void {
  if (!node) return
  const children: any[] = node.children ?? []
  for (const child of children) visit(child, ctx)
}

function visit(node: any, ctx: WalkCtx): void {
  if (!node) return
  // Text nodes are harmless; interpolations are handled by the parent element.
  if (node.type === 5 /* INTERPOLATION */) return
  if (node.type === 2 /* TEXT */) return

  if (node.type === 1 /* ELEMENT */) {
    // Local scope so v-for aliases don't leak out of the loop.
    const savedTainted = new Set(ctx.tainted)
    let elementIsSite = false
    const elSymbols = new Set<string>()

    const props: any[] = node.props ?? []
    const vFor = props.find((p: any) => p.type === 7 /* DIRECTIVE */ && p.name === 'for')
    if (vFor) {
      const exp = vFor.exp?.content ?? ''
      const m = exp.match(/^\s*\(?\s*([^)]+?)\s*\)?\s+(?:in|of)\s+(.+)$/)
      if (m) {
        const listExpr = m[2]
        const listIds = idsIn(listExpr)
        const listTainted = listIds.some(id => ctx.tainted.has(id))
        if (listTainted) {
          elementIsSite = true
          listIds.filter(id => ctx.tainted.has(id)).forEach(id => elSymbols.add(id))
          for (const alias of m[1].split(',').map((s: string) => s.trim()).filter(Boolean)) {
            ctx.tainted.add(alias)
          }
        }
      }
    }

    for (const p of props) {
      if (p === vFor) continue
      const exprs = collectExpressionsFromProp(p)
      for (const e of exprs) {
        const ids = idsIn(e)
        const hit = ids.filter(id => ctx.tainted.has(id))
        if (hit.length > 0) {
          elementIsSite = true
          hit.forEach(id => elSymbols.add(id))
        }
      }

      // Prop edge: :prop="expr" on a child component tag.
      if (isComponentTag(node.tag) && p.type === 7 && p.name === 'bind' && p.arg) {
        const propName = p.arg?.content ?? p.arg?.loc?.source ?? ''
        const expr = p.exp?.content ?? ''
        if (propName && expr) {
          const ids = idsIn(expr)
          if (ids.some(id => ctx.tainted.has(id))) {
            const line = (node.loc?.start?.line ?? 1) + ctx.templateStartLine - 1
            ctx.edges.push({
              from_file: ctx.file,
              from_line: line,
              to_hint: node.tag,
              prop_name: propName,
              source_expr: expr,
            })
          }
        }
      }
    }

    // Direct-child interpolations bind to THIS element (since the transform
    // injects data-annotask-line on the enclosing tag, not the mustache).
    for (const child of (node.children ?? [])) {
      if (child.type === 5 /* INTERPOLATION */) {
        const expr = child.content?.content ?? ''
        const ids = idsIn(expr)
        const hit = ids.filter(id => ctx.tainted.has(id))
        if (hit.length > 0) {
          elementIsSite = true
          hit.forEach(id => elSymbols.add(id))
        }
      }
    }

    if (elementIsSite) pushSite(ctx, node, [...elSymbols])

    for (const child of (node.children ?? [])) visit(child, ctx)

    ctx.tainted.clear()
    savedTainted.forEach(v => ctx.tainted.add(v))
    return
  }

  // Root fragments / if-blocks / etc.
  for (const child of (node.children ?? [])) visit(child, ctx)
}

function pushSite(ctx: WalkCtx, node: any, symbols: string[]): void {
  const localLine = node.loc?.start?.line ?? 1
  const line = localLine + ctx.templateStartLine - 1
  ctx.sites.push({ file: ctx.file, line, tainted_symbols: symbols })
}

function collectExpressionsFromProp(prop: any): string[] {
  if (!prop) return []
  if (prop.type === 7 /* DIRECTIVE */) {
    // Skip event handlers — they aren't render bindings.
    if (prop.name === 'on') return []
    // v-model, v-show, v-if, v-else-if, :attr="expr", v-bind="obj"
    const out: string[] = []
    if (prop.exp?.content) out.push(prop.exp.content)
    return out
  }
  // Static ATTRIBUTE (type 6) carries no expression.
  return []
}

function isComponentTag(tag: string | undefined): boolean {
  if (!tag) return false
  return /^[A-Z]/.test(tag) || tag.includes('-')
}

function idsIn(expr: string): string[] {
  if (!expr) return []
  const out: string[] = []
  const seen = new Set<string>()
  ID_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ID_RE.exec(expr)) !== null) {
    const id = m[0]
    if (EXPR_KEYWORDS.has(id)) continue
    if (/^\d/.test(id)) continue
    if (!seen.has(id)) { seen.add(id); out.push(id) }
  }
  return out
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
