/**
 * JSX binding analyzer — covers React hooks and SolidJS primitives. Both
 * frameworks share JSX syntax and render functions defined as components,
 * so one Babel-parser-backed analyzer covers both.
 *
 * Taint seeding:
 *   const { a, b } = useXxx(...)        → taints [a, b]
 *   const foo = useXxx(...)              → taints [foo]
 *   const [foo, setFoo] = createSignal() → taints [foo] (Solid)
 *   const [foo] = createResource()       → taints [foo] (Solid)
 *
 * JSX walk:
 *   - JSXExpressionContainer / JSXAttribute expressions → identifiers checked against tainted set.
 *   - Taints propagate into `.map((planet) => <Card planet={planet} />)`-style callbacks.
 *   - Capitalized JSXElement with tainted attribute exprs → PropEdge.
 *
 * Falls back to `null` when `@babel/parser` isn't installed so the
 * orchestrator can drop to file-level fallback.
 */
import type { AnalyzeArgs, AnalyzeResult, FrameworkBindingAnalyzer } from './types.js'
import type { BindingSite, PropEdge } from '../../schema.js'

const EXT_RE = /\.(tsx|jsx|ts|js|mjs)$/i

async function tryLoadParser(): Promise<any | null> {
  try {
    // @ts-ignore optional peer dep
    return await import('@babel/parser')
  } catch { return null }
}

export const jsxAnalyzer: FrameworkBindingAnalyzer = {
  id: 'jsx',
  supports(file: string) { return EXT_RE.test(file) },
  async analyze(args: AnalyzeArgs): Promise<AnalyzeResult | null> {
    const babel = await tryLoadParser()
    if (!babel) return null

    // Quick bail-out: file must mention the source or at least one seed.
    const haystack = args.content
    const seeds = args.seeds ?? []
    if (!haystack.includes(args.source_name) && !seeds.some(s => haystack.includes(s.name))) {
      return null
    }

    let ast: any
    try {
      ast = babel.parse(args.content, {
        sourceType: 'module',
        plugins: [
          'jsx',
          'typescript',
          'classProperties',
          'decorators-legacy',
          'topLevelAwait',
          'importAssertions',
        ],
        allowReturnOutsideFunction: true,
        errorRecovery: true,
      })
    } catch { return null }

    const tainted = new Set<string>()
    for (const s of seeds) tainted.add(s.name)

    // Seed from source calls in the whole file.
    seedFromCalls(ast, args.source_name, tainted)

    // Alias fixed-point: re-walk for `const x = <expr>` where expr references
    // a tainted id. Max 5 rounds.
    for (let r = 0; r < 5; r++) {
      const before = tainted.size
      collectAliases(ast, tainted)
      if (tainted.size === before) break
    }

    const sites: BindingSite[] = []
    const edges: PropEdge[] = []
    walk(ast, tainted, { file: args.file, sites, edges })

    if (sites.length === 0 && edges.length === 0) return null
    return { sites, prop_edges: edges, tainted_symbols: [...tainted] }
  },
}

function seedFromCalls(ast: any, sourceName: string, tainted: Set<string>): void {
  recurse(ast, (node: any) => {
    if (node.type !== 'VariableDeclarator') return
    const init = node.init
    if (!init) return
    // useXxx(...) / createSignal(...) / createResource(...)
    if (init.type === 'CallExpression' && init.callee?.type === 'Identifier' && init.callee.name === sourceName) {
      bindPatternIdentifiers(node.id, tainted)
    }
  })
}

function bindPatternIdentifiers(pattern: any, target: Set<string>): void {
  if (!pattern) return
  switch (pattern.type) {
    case 'Identifier':
      target.add(pattern.name)
      break
    case 'ObjectPattern':
      for (const prop of pattern.properties ?? []) {
        if (prop.type === 'RestElement') {
          bindPatternIdentifiers(prop.argument, target)
        } else if (prop.type === 'ObjectProperty' || prop.type === 'Property') {
          // renamed: { planets: ps } → value is the local identifier
          bindPatternIdentifiers(prop.value ?? prop.key, target)
        }
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
      bindPatternIdentifiers(pattern.left, target)
      break
    case 'RestElement':
      bindPatternIdentifiers(pattern.argument, target)
      break
  }
}

function collectAliases(ast: any, tainted: Set<string>): void {
  recurse(ast, (node: any) => {
    if (node.type !== 'VariableDeclarator') return
    const init = node.init
    if (!init || referencesTainted(init, tainted) === false) return
    bindPatternIdentifiers(node.id, tainted)
  })
}

function referencesTainted(node: any, tainted: Set<string>): boolean {
  let found = false
  recurse(node, (n: any) => {
    if (found) return
    if (n.type === 'Identifier' && tainted.has(n.name)) found = true
  })
  return found
}

interface JsxCtx { file: string; sites: BindingSite[]; edges: PropEdge[] }

function walk(ast: any, tainted: Set<string>, ctx: JsxCtx): void {
  visit(ast, new Set(tainted), ctx)
}

function visit(node: any, scope: Set<string>, ctx: JsxCtx): void {
  if (!node || typeof node !== 'object') return

  // Track callback-argument taints for `.map((item) => ...)` when the
  // callee is a member expression whose object is tainted.
  if (node.type === 'CallExpression') {
    const callee = node.callee
    const taintedReceiver = callee?.type === 'MemberExpression'
      && callee.object?.type === 'Identifier'
      && scope.has(callee.object.name)
    if (taintedReceiver) {
      // `.map`, `.filter`, `.forEach`, `.find` → first-arg callback's first param is tainted.
      const methodName = callee.property?.name
      if (methodName && /^(map|filter|forEach|find|flatMap|reduce|some|every)$/.test(methodName)) {
        const firstArg = node.arguments?.[0]
        if (firstArg && (firstArg.type === 'ArrowFunctionExpression' || firstArg.type === 'FunctionExpression')) {
          const paramScope = new Set(scope)
          const firstParam = firstArg.params?.[0]
          if (firstParam) bindPatternIdentifiers(firstParam, paramScope)
          visit(firstArg.body, paramScope, ctx)
          // Visit remaining args with outer scope.
          for (let i = 1; i < (node.arguments?.length ?? 0); i++) visit(node.arguments[i], scope, ctx)
          return
        }
      }
    }
  }

  if (node.type === 'JSXElement') {
    const opening = node.openingElement
    const tag = jsxName(opening?.name)
    let elementIsSite = false
    const elSymbols = new Set<string>()

    for (const attr of (opening?.attributes ?? [])) {
      if (attr.type !== 'JSXAttribute') continue
      const val = attr.value
      if (!val || val.type !== 'JSXExpressionContainer') continue
      const expr = val.expression
      if (!expr) continue
      const ids = collectIds(expr)
      const hit = ids.filter(id => scope.has(id))
      if (hit.length > 0) {
        elementIsSite = true
        hit.forEach(id => elSymbols.add(id))
      }
      if (isComponentTag(tag)) {
        const propName = attr.name?.type === 'JSXIdentifier' ? attr.name.name : ''
        if (propName && hit.length > 0) {
          ctx.edges.push({
            from_file: ctx.file,
            from_line: opening?.loc?.start?.line ?? 0,
            to_hint: tag,
            prop_name: propName,
            source_expr: astText(expr) || hit.join(','),
          })
        }
      }
    }

    // Children: JSXExpressionContainer leaves can make the element a site.
    for (const child of (node.children ?? [])) {
      if (child.type === 'JSXExpressionContainer') {
        const ids = collectIds(child.expression)
        const hit = ids.filter(id => scope.has(id))
        if (hit.length > 0) {
          elementIsSite = true
          hit.forEach(id => elSymbols.add(id))
        }
      }
    }

    if (elementIsSite) {
      ctx.sites.push({
        file: ctx.file,
        line: opening?.loc?.start?.line ?? 0,
        tainted_symbols: [...elSymbols],
      })
    }
    // Recurse into children with unchanged scope.
    for (const child of (node.children ?? [])) visit(child, scope, ctx)
    // Also recurse into attributes (they can contain nested JSX/callbacks).
    for (const attr of (opening?.attributes ?? [])) visit(attr, scope, ctx)
    return
  }

  // Generic recursion for anything else.
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'parent' || key === 'leadingComments' || key === 'trailingComments') continue
    const value = (node as any)[key]
    if (!value) continue
    if (Array.isArray(value)) {
      for (const v of value) visit(v, scope, ctx)
    } else if (typeof value === 'object') {
      visit(value, scope, ctx)
    }
  }
}

function jsxName(name: any): string {
  if (!name) return ''
  if (name.type === 'JSXIdentifier') return name.name
  if (name.type === 'JSXMemberExpression') return `${jsxName(name.object)}.${jsxName(name.property)}`
  return ''
}

function isComponentTag(tag: string): boolean {
  return /^[A-Z]/.test(tag) || tag.includes('.')
}

function collectIds(node: any): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  recurse(node, (n: any) => {
    if (n.type === 'Identifier' && !seen.has(n.name)) { seen.add(n.name); out.push(n.name) }
  })
  return out
}

function astText(node: any): string {
  if (!node) return ''
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MemberExpression') return `${astText(node.object)}.${astText(node.property)}`
  return ''
}

function recurse(node: any, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'parent' || key === 'leadingComments' || key === 'trailingComments') continue
    const value = (node as any)[key]
    if (!value) continue
    if (Array.isArray(value)) { for (const v of value) recurse(v, visit) }
    else if (typeof value === 'object') { recurse(value, visit) }
  }
}
