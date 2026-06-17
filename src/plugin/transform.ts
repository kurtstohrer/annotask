/**
 * Source file transform — injects data-annotask-* attributes on HTML elements.
 *
 * Supports Vue SFC (.vue), React JSX (.jsx/.tsx), SolidJS (.jsx/.tsx),
 * Svelte (.svelte), Astro (.astro), Lit/Web Components (html`` in .ts/.js),
 * and plain HTML.
 * The core HTML scanner (injectAttributes + findTagEnd) is shared across
 * all frameworks. Each framework has its own extraction logic to locate
 * the markup regions within a source file.
 */

/**
 * Top-level dispatcher. Detects framework by file extension and delegates
 * to the appropriate transform function.
 */
export function transformFile(
  code: string,
  filePath: string,
  projectRoot: string,
  mfe?: string
): string | null {
  if (filePath.endsWith('.vue')) return transformVueSFC(code, filePath, projectRoot, mfe)
  if (filePath.endsWith('.svelte')) return transformSvelte(code, filePath, projectRoot, mfe)
  if (/\.[jt]sx$/.test(filePath)) return transformJSX(code, filePath, projectRoot, mfe)
  if (filePath.endsWith('.html')) return transformHTML(code, filePath, projectRoot, mfe)
  if (filePath.endsWith('.astro')) return transformAstro(code, filePath, projectRoot, mfe)
  return null
}

/**
 * Parse every named/default ESM import in `code` and return a map of
 * `ImportedName → sourceModule`. Used by the tag injector so `<Button>` can
 * carry a `data-annotask-source-module` attribute identifying which library
 * it came from — the bridge then disambiguates two libraries that both
 * expose `Button` even when the library wrapper swallows other data-* attrs.
 *
 * Deliberately regex-based to match the rest of the transform's lightweight
 * parsing. Misses destructured re-exports / dynamic imports (rare in code
 * that reaches the runtime as a JSX tag).
 */
const TRANSFORM_IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*(['"`])([^'"`]+)\2/g
const TRANSFORM_DEFAULT_IMPORT_RE = /import\s+([A-Z][A-Za-z0-9_$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*(['"`])([^'"`]+)\2/g

export function parseImports(code: string): Map<string, string> {
  const out = new Map<string, string>()
  let m: RegExpExecArray | null
  TRANSFORM_IMPORT_RE.lastIndex = 0
  while ((m = TRANSFORM_IMPORT_RE.exec(code)) !== null) {
    const from = m[3]
    for (const rawPart of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      // Strip inline `type` modifier so `import { type Foo }` doesn't record.
      if (/^type\s/.test(rawPart)) continue
      // `Foo` → key Foo; `Foo as Bar` → key Bar (the local binding JSX uses).
      const pair = rawPart.split(/\s+as\s+/).map(s => s.trim())
      const local = pair[pair.length - 1]
      // Accept any valid JS identifier. Libraries like antenna-component-library
      // export camelCase names (`dataTable`, `icon`, `pill`); filtering by
      // PascalCase would drop them, and the bridge's module-scoped filter at
      // messages.ts:397 would then reject every matching element (no
      // `data-annotask-source-module` emitted → nothing survives).
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(local)) continue
      if (!out.has(local)) out.set(local, from)
    }
  }
  TRANSFORM_DEFAULT_IMPORT_RE.lastIndex = 0
  while ((m = TRANSFORM_DEFAULT_IMPORT_RE.exec(code)) !== null) {
    const local = m[1]
    const from = m[3]
    if (!out.has(local)) out.set(local, from)
  }
  return out
}

// ── Component registry epilogue ─────────────────────────
//
// Populates `window.__ANNOTASK_COMPONENTS__` with a file's imported components
// so the bridge's `tryMountComponent` can live-mount REAL project components
// when a wireframe/insert drops one — the keystone that makes "real components
// render on drop" true on Vite (the Vite plugin previously injected the
// framework runtimes but never the component map, so only globally-registered
// Vue components could mount).
//
// Supersedes the webpack loader's inline registration and fixes its blind
// spots: it covers NAMED imports (`import { Button } from '@mantine/core'`),
// ALIASED imports (registered under the EXPORT name so a lookup by the catalog
// name resolves the local binding), and RELATIVE/local imports
// (`./PlanetCard.vue`) — the loader only handled default, non-relative imports.
//
// PascalCase-only so hooks/utilities (`ref`, `useRoute`) don't pollute the
// registry; each entry is `typeof`-guarded so a type-only binding that got
// stripped at compile time never throws.
const REG_NAMED_IMPORT_RE = /import\s+(?!type\b)(?:[A-Za-z0-9_$]+\s*,\s*)?\{([^}]+)\}\s*from\s*['"`][^'"`]+['"`]/g
const REG_DEFAULT_IMPORT_RE = /import\s+([A-Z][A-Za-z0-9_$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"`][^'"`]+['"`]/g

/** Collect `exportName → localBinding` for every PascalCase component import. */
function collectComponentImports(code: string): Map<string, string> {
  const out = new Map<string, string>()
  let m: RegExpExecArray | null
  REG_NAMED_IMPORT_RE.lastIndex = 0
  while ((m = REG_NAMED_IMPORT_RE.exec(code)) !== null) {
    for (const raw of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      if (/^type\s/.test(raw)) continue
      const parts = raw.split(/\s+as\s+/).map(s => s.trim())
      const exportName = parts[0]
      const binding = parts[parts.length - 1]
      if (!/^[A-Z][A-Za-z0-9_$]*$/.test(exportName)) continue
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(binding)) continue
      if (!out.has(exportName)) out.set(exportName, binding)
    }
  }
  REG_DEFAULT_IMPORT_RE.lastIndex = 0
  while ((m = REG_DEFAULT_IMPORT_RE.exec(code)) !== null) {
    const name = m[1]
    if (!out.has(name)) out.set(name, name)
  }
  return out
}

/**
 * Append the component-registry epilogue to an already-transformed source file.
 * Injected before the last `</script>` for Vue/Svelte SFCs (so the bindings are
 * in scope) and at module end for JSX/TSX. No-op when there's nothing to
 * register. Idempotent and side-effect-light (one window-guarded IIFE).
 */
export function injectComponentRegistry(transformed: string, filePath: string): string {
  const imports = collectComponentImports(transformed)
  if (imports.size === 0) return transformed
  const body = [...imports.entries()]
    .map(([name, binding]) => `if(typeof ${binding}!=='undefined')__uf_r[${JSON.stringify(name)}]=${binding};`)
    .join('')
  const epilogue = `\n;(function(){if(typeof window==='undefined')return;var __uf_r=window.__ANNOTASK_COMPONENTS__=window.__ANNOTASK_COMPONENTS__||{};${body}})();\n`
  if ((filePath.endsWith('.vue') || filePath.endsWith('.svelte')) && transformed.includes('</script>')) {
    const idx = transformed.lastIndexOf('</script>')
    return transformed.slice(0, idx) + epilogue + transformed.slice(idx)
  }
  return transformed + epilogue
}

// ── Vue SFC ─────────────────────────────────────────────

/**
 * Transform a Vue SFC's raw source to inject data-annotask-* attributes
 * on every element in the <template> block.
 */
export function transformVueSFC(
  code: string,
  filePath: string,
  projectRoot: string,
  mfe?: string
): string | null {
  if (!code.includes('<template')) return null

  const templateMatch = code.match(/<template(\s[^>]*)?>/)
  if (!templateMatch) return null

  const templateStart = code.indexOf(templateMatch[0])
  const templateEnd = code.lastIndexOf('</template>')
  if (templateEnd === -1) return null

  const templateOpenTagEnd = templateStart + templateMatch[0].length
  const templateContent = code.slice(templateOpenTagEnd, templateEnd)

  const relativeFile = relativePath(filePath, projectRoot)
  const componentName = extractComponentName(filePath)
  const templateStartLine = code.slice(0, templateOpenTagEnd).split('\n').length
  const imports = parseImports(code)

  const injected = injectAttributes(templateContent, relativeFile, componentName, templateStartLine, { mfe, imports })
  if (!injected) return null

  return code.slice(0, templateOpenTagEnd) + injected + code.slice(templateEnd)
}

/** @deprecated Use transformVueSFC instead */
export const transformSFC = transformVueSFC

// ── Svelte ──────────────────────────────────────────────

/**
 * Transform a Svelte component. Markup in .svelte files is everything
 * NOT inside <script> or <style> blocks.
 */
export function transformSvelte(
  code: string,
  filePath: string,
  projectRoot: string,
  mfe?: string
): string | null {
  const relativeFile = relativePath(filePath, projectRoot)
  const componentName = extractComponentName(filePath)

  // Find all <script> and <style> block ranges (including their tags)
  const blockRanges = findBlockRanges(code, ['script', 'style'])

  // Collect markup regions (gaps between blocks)
  const markupRegions = getMarkupRegions(code, blockRanges)

  if (markupRegions.length === 0) return null

  let result = ''
  let lastIndex = 0
  let changed = false
  const imports = parseImports(code)

  for (const region of markupRegions) {
    // Add everything before this region (script/style blocks)
    result += code.slice(lastIndex, region.start)

    const regionContent = code.slice(region.start, region.end)
    const regionStartLine = code.slice(0, region.start).split('\n').length

    const injected = injectAttributes(
      regionContent,
      relativeFile,
      componentName,
      regionStartLine,
      // trackBraces: Svelte attribute expressions use bare `{expr}` — the
      // `>` in `onclick={() => ...}` or `class={a > b}` must not terminate
      // the tag early. Full jsxMode would be wrong here: its type-context
      // heuristic treats `text<span>` as a generic and skips real markup.
      { skipTags: SVELTE_SKIP_TAGS, trackBraces: true, mfe, imports }
    )

    if (injected) {
      result += injected
      changed = true
    } else {
      result += regionContent
    }

    lastIndex = region.end
  }

  if (!changed) return null

  result += code.slice(lastIndex)
  return result
}

const SVELTE_SKIP_TAGS = new Set([
  'script', 'style',
  'svelte:head', 'svelte:window', 'svelte:document', 'svelte:body',
  'svelte:options', 'svelte:fragment', 'svelte:self', 'svelte:component',
  'svelte:element', 'svelte:boundary',
])

// ── React JSX ───────────────────────────────────────────

/**
 * Transform a React JSX/TSX file. JSX is interleaved with JavaScript,
 * so we scan the full file with brace-depth tracking enabled.
 */
export function transformJSX(
  code: string,
  filePath: string,
  projectRoot: string,
  mfe?: string
): string | null {
  const relativeFile = relativePath(filePath, projectRoot)
  const componentName = extractComponentName(filePath)
  const imports = parseImports(code)

  const injected = injectAttributes(code, relativeFile, componentName, 1, {
    jsxMode: true,
    skipTags: JSX_SKIP_TAGS,
    mfe,
    imports,
  })

  return injected
}

/** Tags to skip in JSX mode. Fragments have empty tag names and are handled separately. */
const JSX_SKIP_TAGS = new Set(['script', 'style'])

// ── HTML ───────────────────────────────────────────────

/**
 * Transform a plain HTML file. Injects data-annotask-* attributes on
 * every element inside the <body> block.
 */
export function transformHTML(
  code: string,
  filePath: string,
  projectRoot: string,
  mfe?: string
): string | null {
  const bodyMatch = code.match(/<body(\s[^>]*)?>/)
  if (!bodyMatch) return null

  const bodyStart = code.indexOf(bodyMatch[0])
  const bodyEnd = code.lastIndexOf('</body>')
  if (bodyEnd === -1) return null

  const bodyOpenTagEnd = bodyStart + bodyMatch[0].length
  const bodyContent = code.slice(bodyOpenTagEnd, bodyEnd)

  const relativeFile = relativePath(filePath, projectRoot)
  const componentName = extractComponentName(filePath)
  const bodyStartLine = code.slice(0, bodyOpenTagEnd).split('\n').length

  const injected = injectAttributes(bodyContent, relativeFile, componentName, bodyStartLine, {
    skipTags: HTML_SKIP_TAGS,
    mfe,
  })
  if (!injected) return null

  return code.slice(0, bodyOpenTagEnd) + injected + code.slice(bodyEnd)
}

const HTML_SKIP_TAGS = new Set(['script', 'style'])

// ── Astro ──────────────────────────────────────────────

/**
 * Transform an Astro component. Markup is everything NOT inside the
 * --- frontmatter ---, <script>, or <style> blocks. Astro uses JSX-like
 * {expressions} in its template, so we enable jsxMode.
 */
export function transformAstro(
  code: string,
  filePath: string,
  projectRoot: string,
  mfe?: string
): string | null {
  const relativeFile = relativePath(filePath, projectRoot)
  const componentName = extractComponentName(filePath)

  // Find frontmatter block (--- ... ---). Astro frontmatter opens at the top
  // of the file and both fences sit alone on their own lines — a bare
  // indexOf('---') would mis-anchor on a `---` appearing later in markup
  // content or inside a frontmatter string.
  const frontmatterRanges: Range[] = []
  const fmOpen = code.match(/^\uFEFF?(?:[ \t]*\r?\n)*---\r?\n/)
  if (fmOpen) {
    const fmStart = fmOpen[0].indexOf('---')
    const closeRe = /^---[ \t\r]*$/gm
    closeRe.lastIndex = fmOpen[0].length
    const fmClose = closeRe.exec(code)
    if (fmClose) {
      frontmatterRanges.push({ start: fmStart, end: fmClose.index + fmClose[0].length })
    }
  }

  const blockRanges = [
    ...frontmatterRanges,
    ...findBlockRanges(code, ['script', 'style']),
  ]
  blockRanges.sort((a, b) => a.start - b.start)

  const markupRegions = getMarkupRegions(code, blockRanges)
  if (markupRegions.length === 0) return null

  let result = ''
  let lastIndex = 0
  let changed = false
  const imports = parseImports(code)

  for (const region of markupRegions) {
    result += code.slice(lastIndex, region.start)

    const regionContent = code.slice(region.start, region.end)
    const regionStartLine = code.slice(0, region.start).split('\n').length

    const injected = injectAttributes(regionContent, relativeFile, componentName, regionStartLine, {
      jsxMode: true,
      skipTags: ASTRO_SKIP_TAGS,
      mfe,
      imports,
    })

    if (injected) {
      result += injected
      changed = true
    } else {
      result += regionContent
    }

    lastIndex = region.end
  }

  if (!changed) return null
  result += code.slice(lastIndex)
  return result
}

const ASTRO_SKIP_TAGS = new Set([
  'script', 'style', 'Fragment',
])

/**
 * Known TypeScript/JS generic type names that should NOT be treated as JSX tags.
 * When the scanner sees `<Array` or `<Promise` etc., it skips them.
 */
const TS_GENERIC_NAMES = new Set([
  'Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Generator',
  'AsyncGenerator', 'Iterable', 'AsyncIterable', 'Iterator',
  'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit',
  'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'Parameters',
  'InstanceType', 'ConstructorParameters', 'Awaited',
  'ReadonlyArray', 'ReadonlyMap', 'ReadonlySet',
  'Uppercase', 'Lowercase', 'Capitalize', 'Uncapitalize',
])

// ── Shared Utilities ────────────────────────────────────

export function extractComponentName(filePath: string): string {
  const fileName = filePath.split('/').pop() || ''
  return fileName.replace(/\.(vue|svelte|astro|html|[jt]sx?)$/, '')
}

function relativePath(filePath: string, projectRoot: string): string {
  return filePath.startsWith(projectRoot)
    ? filePath.slice(projectRoot.length).replace(/^\//, '')
    : filePath
}

/** Extract the identifier bound to `:is="..."` / `v-bind:is="..."` on a Vue
 *  `<component>` tag. Returns null for string literals (`is="MyComp"`), dotted
 *  expressions (`foo.bar`), or anything that isn't a bare identifier — those
 *  don't cleanly resolve to an ESM import and don't need the module rewrite.
 *  Only called for parsed `<component>` opening tags, so the regex cost is
 *  bounded to one pass per dynamic component. */
function extractIsBinding(tagSource: string): string | null {
  const m = tagSource.match(/\s(?::is|v-bind:is)\s*=\s*(['"])\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\1/)
  return m ? m[2] : null
}

interface InjectOptions {
  /** Enable JSX mode: track {} brace depth, skip TS generics, and treat
   *  statement-scope strings/comments/regexes as opaque (JSX is interleaved
   *  with JavaScript, so `const a = "<div>"` must not be instrumented) */
  jsxMode?: boolean
  /** Track `{}` brace depth inside tags WITHOUT the other jsxMode behaviors.
   *  Svelte markup needs this: attribute expressions like `onclick={() => ...}`
   *  contain bare `>` that would otherwise end the tag early — but Svelte text
   *  content sits directly against tags (`count is {n}<span>`), so jsxMode's
   *  type-context heuristic would misread real markup as TS generics. */
  trackBraces?: boolean
  /** Tags to skip (won't have attributes injected) */
  skipTags?: Set<string>
  /** MFE identity for multi-project setups */
  mfe?: string
  /** Map of `LocalName → importSource` for this file. When the scanner
   *  lands on `<Name>` and `Name` is in the map, a `data-annotask-source-
   *  module="<source>"` attribute is emitted. Lets the bridge tell two
   *  libraries' Buttons apart. */
  imports?: Map<string, string>
}

/**
 * Scope frame for the jsxMode top-level scanner. The stack distinguishes the
 * contexts where `<tag` is legal JSX (statement scope, `{...}` expressions,
 * `${...}` interpolations) from the contexts where it is plain text or string
 * content (JSX element children, raw template-literal text). String, comment,
 * and regex literals are skipped inline within JS-like scopes and never land
 * on the stack. An empty stack means JS statement scope.
 */
interface JsxScope {
  /** jsx = element children, expr = `{...}` in children, template = raw
   *  template-literal text, interp = `${...}` inside a template literal */
  kind: 'jsx' | 'expr' | 'template' | 'interp'
  /** Brace nesting for expr/interp — the scope pops when `}` arrives at depth 0 */
  depth: number
}

/**
 * Walk through HTML/JSX markup and inject data-annotask-* attributes on
 * every element's opening tag.
 *
 * Uses a character-level scanner that is quote-aware, so `>` inside
 * attribute values does not prematurely close the tag.
 */
export function injectAttributes(
  template: string,
  file: string,
  componentName: string,
  templateStartLine: number,
  options?: InjectOptions,
): string | null {
  const skipTags = options?.skipTags ?? DEFAULT_SKIP_TAGS
  const jsxMode = options?.jsxMode ?? false
  const trackBraces = jsxMode || (options?.trackBraces ?? false)
  const mfe = options?.mfe
  const imports = options?.imports

  let result = ''
  let lastIndex = 0
  let changed = false
  let i = 0

  // jsxMode scope stack — see JsxScope. Stays empty for non-JSX callers.
  const scopes: JsxScope[] = []

  while (i < template.length) {
    if (jsxMode) {
      const top = scopes.length > 0 ? scopes[scopes.length - 1] : undefined

      if (top === undefined || top.kind === 'expr' || top.kind === 'interp') {
        // JS statement/expression scope — strings, comments, and regex
        // literals are opaque here. Without this, `const a = "<div>x</div>"`
        // gets attributes injected INSIDE the string literal (a hard syntax
        // error for double-quoted strings, since the injection itself uses
        // double quotes; template literals were silently mutated).
        const ch = template[i]
        if (ch === '/' && template[i + 1] === '/') {
          const nl = template.indexOf('\n', i + 2)
          i = nl === -1 ? template.length : nl + 1
          continue
        }
        if (ch === '/' && template[i + 1] === '*') {
          const end = template.indexOf('*/', i + 2)
          i = end === -1 ? template.length : end + 2
          continue
        }
        if (ch === '"' || ch === "'") {
          i = skipStringLiteral(template, i)
          continue
        }
        if (ch === '`') {
          scopes.push({ kind: 'template', depth: 0 })
          i++
          continue
        }
        if (ch === '/' && regexCanStart(template, i)) {
          i = skipRegexLiteral(template, i)
          continue
        }
        if (ch === '{') {
          if (top) top.depth++
          i++
          continue
        }
        if (ch === '}') {
          // Terminates the expr/interp scope at depth 0; a stray `}` at
          // statement scope (function body close) is just skipped.
          if (top) {
            if (top.depth === 0) scopes.pop()
            else top.depth--
          }
          i++
          continue
        }
        if (ch === '<' && template[i + 1] === '>') {
          // JSX fragment open — the tag scanner below only fires on
          // `<` + letter, so fragments would otherwise go untracked and the
          // matching `</>` would pop a real element's children scope.
          scopes.push({ kind: 'jsx', depth: 0 })
          i += 2
          continue
        }
        // Fall through to the tag scanner — JSX is legal in this scope.
      } else if (top.kind === 'template') {
        // Raw template-literal text — tags here are string content, not JSX.
        // Only `${` re-enters a JS scope where JSX is legal again (and must
        // still be transformed — see transform-react tests for `${cond ? <span/> : null}`).
        const ch = template[i]
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === '`') {
          scopes.pop()
          i++
          continue
        }
        if (ch === '$' && template[i + 1] === '{') {
          scopes.push({ kind: 'interp', depth: 0 })
          i += 2
          continue
        }
        i++
        continue
      } else {
        // JSX element children — quotes, slashes, and backticks are plain
        // text here (`<div>it's 1/2</div>`); only `{` opens an expression
        // scope and `<>` a nested fragment.
        if (template[i] === '{') {
          scopes.push({ kind: 'expr', depth: 0 })
          i++
          continue
        }
        if (template[i] === '<' && template[i + 1] === '>') {
          scopes.push({ kind: 'jsx', depth: 0 })
          i += 2
          continue
        }
        // Fall through to the comment/closing-tag/tag handling below.
      }
    }

    // Skip comments
    if (template.startsWith('<!--', i)) {
      const end = template.indexOf('-->', i + 4)
      i = end === -1 ? template.length : end + 3
      continue
    }

    // Skip closing tags
    if (template.startsWith('</', i)) {
      const end = template.indexOf('>', i + 2)
      i = end === -1 ? template.length : end + 1
      // A closing tag (or `</>` fragment close) ends the current children
      // scope. Guarded on kind so a stray closer never pops an expr/template.
      if (jsxMode && scopes.length > 0 && scopes[scopes.length - 1].kind === 'jsx') {
        scopes.pop()
      }
      continue
    }

    // Check for opening tag
    if (template[i] === '<' && i + 1 < template.length && /[a-zA-Z]/.test(template[i + 1])) {
      const tagStart = i
      i++ // past '<'

      // Read tag name (including namespaced tags like svelte:head)
      const nameStart = i
      while (i < template.length && /[a-zA-Z0-9\-:]/.test(template[i])) i++
      const tagName = template.slice(nameStart, i)

      // Inside JSX element children, `<` + letter is ALWAYS a tag — type
      // syntax is not legal there, and the isTypeContext heuristic would
      // misread inline text before a tag (`1/2 <em>`) as a generic.
      const inJsxChildren =
        jsxMode && scopes.length > 0 && scopes[scopes.length - 1].kind === 'jsx'

      // In JSX mode, skip React fragments (empty tag name won't reach here,
      // but <> starts with < followed by > which isn't [a-zA-Z])
      // Skip known TypeScript generics
      if (jsxMode && !inJsxChildren && TS_GENERIC_NAMES.has(tagName)) {
        // This is a TS generic like Array<string>, not a JSX tag
        // Find the closing > accounting for nested generics
        i = skipGeneric(template, i)
        continue
      }

      // In JSX mode, check if this looks like a type context
      // (preceded by : or as or extends or implements)
      if (jsxMode && !inJsxChildren && isTypeContext(template, tagStart)) {
        i = skipGeneric(template, i)
        continue
      }

      // Scan past attributes to find the closing > or />
      const tagEndIndex = findTagEnd(template, i, trackBraces)

      const tagSource = template.slice(tagStart, tagEndIndex)

      // Track element nesting for the jsxMode scope stack: a non-self-closing,
      // non-void opening tag puts the scanner into JSX-children scope, where
      // quotes/comments are plain text. Computed for skipped/instrumented tags
      // too — otherwise `<script>...</script>` in JSX would desync the stack.
      const opensChildren =
        jsxMode && !tagSource.endsWith('/>') && !VOID_TAGS.has(tagName.toLowerCase())

      // Skip tags we don't want to instrument
      if (skipTags.has(tagName) || skipTags.has(tagName.toLowerCase())) {
        if (opensChildren) scopes.push({ kind: 'jsx', depth: 0 })
        i = tagEndIndex
        continue
      }

      // Skip if already instrumented
      if (tagSource.includes('data-annotask-file')) {
        if (opensChildren) scopes.push({ kind: 'jsx', depth: 0 })
        i = tagEndIndex
        continue
      }

      // Calculate file-relative line number
      const lineInFile = templateStartLine + template.slice(0, tagStart).split('\n').length - 1

      // Vue <component :is="x" /> — the literal tag is `component`, but the
      // REAL identity is the `:is` binding (e.g. `dataTable`). Without this
      // unwrap, the shell's module-scoped DOM matcher at messages.ts:394
      // would see `source-tag="component"` with no module and reject every
      // dynamic-component instance, so libraries that ship lowercase exports
      // (commonly consumed via `<component :is="icon" />`) never highlight.
      let effectiveTagName = tagName
      if (!jsxMode && tagName === 'component') {
        const isBinding = extractIsBinding(tagSource)
        if (isBinding) effectiveTagName = isBinding
      }

      // Look up the import source for `effectiveTagName`. Only tags whose
      // name matches an ESM binding imported in this file end up marked —
      // plain DOM tags like `<div>` aren't imported, so they stay unmarked.
      const srcModule = imports?.get(effectiveTagName)
      const injection = ` data-annotask-file="${file}" data-annotask-line="${lineInFile}" data-annotask-component="${componentName}" data-annotask-source-tag="${effectiveTagName}"${srcModule ? ` data-annotask-source-module="${srcModule}"` : ''}${mfe ? ` data-annotask-mfe="${mfe}"` : ''}`

      // Find the insertion point: right before '>' or '/>'
      let insertAt = tagEndIndex - 1 // the '>'
      if (insertAt > 0 && template[insertAt - 1] === '/') insertAt-- // before '/>'

      result += template.slice(lastIndex, insertAt)
      result += injection
      result += template.slice(insertAt, tagEndIndex)
      lastIndex = tagEndIndex
      changed = true
      i = tagEndIndex

      if (opensChildren) scopes.push({ kind: 'jsx', depth: 0 })

      continue
    }

    i++
  }

  if (!changed) return null

  result += template.slice(lastIndex)
  return result
}

const DEFAULT_SKIP_TAGS = new Set(['script', 'style', 'template', 'slot'])

/** Elements that never have children in HTML — opening one must NOT push a
 *  JSX-children scope. Astro markup may write these HTML-style (`<br>`)
 *  without a closing tag, which would otherwise desync the scope stack. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/**
 * Skip a `'...'` or `"..."` string literal starting at `i` (the opening
 * quote). Returns the index just past the closing quote. Bails at a raw
 * newline (plain strings can't span lines) so a stray quote in odd input
 * never swallows the rest of the file.
 */
function skipStringLiteral(code: string, i: number): number {
  const quote = code[i]
  i++
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') i++
    else if (ch === quote) return i + 1
    else if (ch === '\n') return i
    i++
  }
  return i
}

/** Keywords after which a `/` starts a regex literal, not division. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
])

/**
 * Heuristic: can the `/` at position `i` start a regex literal (vs. being a
 * division operator)? Mirrors the standard JS lexer rule — a regex may only
 * appear where an expression is expected: after an operator/opening
 * punctuation or an expression keyword, never directly after an identifier,
 * number literal, or closing `)`/`]`.
 */
function regexCanStart(code: string, i: number): boolean {
  let j = i - 1
  while (j >= 0 && /\s/.test(code[j])) j--
  if (j < 0) return true
  const ch = code[j]
  if (/[a-zA-Z0-9_$]/.test(ch)) {
    // Identifier or number before `/` means division — unless it's a keyword
    // that expects an expression (`return /re/`, `typeof /re/`, ...).
    const wordEnd = j + 1
    while (j >= 0 && /[a-zA-Z0-9_$]/.test(code[j])) j--
    return REGEX_PRECEDING_KEYWORDS.has(code.slice(j + 1, wordEnd))
  }
  return ch !== ')' && ch !== ']'
}

/**
 * Skip a regex literal starting at `i` (the opening `/`). Returns the index
 * just past the closing `/` (flags are plain identifier chars — the normal
 * scanner walks them). Bails at a raw newline, since regex literals cannot
 * span lines — that caps the damage to one character if the division-vs-regex
 * heuristic ever misfires.
 */
function skipRegexLiteral(code: string, i: number): number {
  const start = i
  i++ // past opening '/'
  let inClass = false
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') i++
    else if (ch === '\n') return start + 1
    else if (ch === '[') inClass = true
    else if (ch === ']') inClass = false
    else if (ch === '/' && !inClass) return i + 1
    i++
  }
  return start + 1
}

/**
 * Starting from position `i` (after the tag name), scan forward past
 * all attributes and find the closing `>`. Handles quoted strings
 * so that `>` inside `"..."`, `'...'`, or `` `...` `` doesn't end the tag.
 *
 * With `trackBraces` (JSX mode, and Svelte markup whose attributes use bare
 * `{expr}` values), also tracks `{}` brace depth so that `>` inside
 * expression attributes (e.g., `{x > 5}`, `onclick={() => fn()}`) doesn't
 * end the tag.
 */
export function findTagEnd(template: string, i: number, trackBraces = false): number {
  let inQuote: string | null = null
  let braceDepth = 0
  // Stack of saved (inQuote, braceDepth) pairs for nested template literals.
  // When a backtick opens inside a JSX expression, the surrounding brace depth
  // must be restored when the template literal closes — otherwise the closing
  // backtick check (braceDepth === 0) is wrong.
  const stack: Array<{ inQuote: string | null; braceDepth: number }> = []

  while (i < template.length) {
    const ch = template[i]

    if (inQuote === '`') {
      if (ch === '`' && braceDepth === 0) {
        // Exit template literal — restore prior context.
        const prev = stack.pop()
        inQuote = prev ? prev.inQuote : null
        braceDepth = prev ? prev.braceDepth : 0
      } else if (ch === '$' && i + 1 < template.length && template[i + 1] === '{') {
        braceDepth++
        i++ // skip past '{'
      } else if (ch === '}' && braceDepth > 0) {
        braceDepth--
      }
    } else if (inQuote) {
      if (ch === '\\') {
        i++ // skip escaped character
      } else if (ch === inQuote) {
        inQuote = null
      }
    } else {
      if (ch === '"' || ch === "'") {
        inQuote = ch
      } else if (ch === '`') {
        // Save current context before entering template literal.
        stack.push({ inQuote, braceDepth })
        inQuote = '`'
        braceDepth = 0
      } else if (trackBraces && ch === '{') {
        braceDepth++
      } else if (trackBraces && ch === '}' && braceDepth > 0) {
        braceDepth--
      } else if (ch === '>' && braceDepth === 0) {
        return i + 1
      }
    }
    i++
  }

  return i
}

// ── Svelte helpers ──────────────────────────────────────

interface Range { start: number; end: number }

/**
 * Find all ranges of the given block-level tags (e.g., script, style)
 * including their opening and closing tags.
 */
function findBlockRanges(code: string, tagNames: string[]): Range[] {
  const ranges: Range[] = []
  for (const tag of tagNames) {
    // Match opening tags like <script>, <script context="module">, <style lang="scss">
    const openRegex = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi')
    let match
    while ((match = openRegex.exec(code)) !== null) {
      const start = match.index
      const closeTag = `</${tag}>`
      const closeIndex = code.indexOf(closeTag, start + match[0].length)
      if (closeIndex !== -1) {
        ranges.push({ start, end: closeIndex + closeTag.length })
      }
    }
  }
  // Sort by start position
  ranges.sort((a, b) => a.start - b.start)
  return ranges
}

/**
 * Given sorted block ranges, return the markup regions (gaps between blocks).
 */
function getMarkupRegions(code: string, blockRanges: Range[]): Range[] {
  const regions: Range[] = []
  let cursor = 0

  for (const block of blockRanges) {
    if (block.start > cursor) {
      const region = code.slice(cursor, block.start)
      // Only include regions that have actual markup (not just whitespace)
      if (region.trim().length > 0) {
        regions.push({ start: cursor, end: block.start })
      }
    }
    cursor = block.end
  }

  // Region after the last block
  if (cursor < code.length) {
    const region = code.slice(cursor)
    if (region.trim().length > 0) {
      regions.push({ start: cursor, end: code.length })
    }
  }

  return regions
}

// ── JSX helpers ─────────────────────────────────────────

/**
 * Check if the `<` at position `tagStart` is in a TypeScript type/generic
 * context rather than JSX.
 *
 * Key insight: In JSX, `<` is always preceded by whitespace, an operator,
 * punctuation, or a JSX-context keyword (return, yield, etc.).
 * In generics, `<` immediately follows an identifier: `Array<string>`,
 * `foo<T>()`, `Promise<void>`.
 */
function isTypeContext(code: string, tagStart: number): boolean {
  // Walk backward past whitespace to find the preceding token
  let j = tagStart - 1
  while (j >= 0 && (code[j] === ' ' || code[j] === '\t' || code[j] === '\n' || code[j] === '\r')) j--
  if (j < 0) return false

  const ch = code[j]

  // Preceded by : (type annotation), < (nested generic), . (member access in type)
  if (ch === ':' || ch === '<' || ch === '.') return true

  // If preceded by an identifier character, it's likely a generic: Array<T>, foo<T>
  // Exception: JSX-context keywords like return, yield, case, etc.
  if (/[a-zA-Z0-9_$]/.test(ch)) {
    // Read the full preceding word
    let wordEnd = j + 1
    while (j >= 0 && /[a-zA-Z0-9_$]/.test(code[j])) j--
    const word = code.slice(j + 1, wordEnd)

    // These keywords can precede JSX: return <div>, yield <X />, etc.
    const jsxKeywords = new Set(['return', 'yield', 'case', 'default', 'throw', 'new', 'in', 'of', 'else'])
    if (jsxKeywords.has(word)) return false

    // Any other identifier before < means it's a generic
    return true
  }

  // Check for keyword tokens that signal type context
  // (already handled above via identifier check, but keep for safety)
  const typeKeywords = ['as', 'extends', 'implements', 'typeof', 'keyof', 'infer', 'type']
  for (const kw of typeKeywords) {
    if (j >= kw.length - 1) {
      const slice = code.slice(j - kw.length + 1, j + 1)
      if (slice === kw) {
        const before = j - kw.length
        if (before < 0 || /\s|[,;({[<>|&=!?+\-*/]/.test(code[before])) {
          return true
        }
      }
    }
  }

  return false
}

/**
 * Skip past a TypeScript generic expression like `<string>` or `<T extends U>`.
 * Tracks nested `<>` depth.
 */
function skipGeneric(code: string, i: number): number {
  let depth = 1
  while (i < code.length && depth > 0) {
    if (code[i] === '<') depth++
    else if (code[i] === '>') depth--
    i++
  }
  return i
}
