/**
 * Source file transform — injects data-annotask-* attributes on HTML elements.
 *
 * Supports Vue SFC (.vue), React JSX (.jsx/.tsx), and Svelte (.svelte).
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
  projectRoot: string
): string | null {
  if (filePath.endsWith('.vue')) return transformVueSFC(code, filePath, projectRoot)
  if (filePath.endsWith('.svelte')) return transformSvelte(code, filePath, projectRoot)
  if (/\.[jt]sx$/.test(filePath)) return transformJSX(code, filePath, projectRoot)
  return null
}

// ── Vue SFC ─────────────────────────────────────────────

/**
 * Transform a Vue SFC's raw source to inject data-annotask-* attributes
 * on every element in the <template> block.
 */
export function transformVueSFC(
  code: string,
  filePath: string,
  projectRoot: string
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

  const injected = injectAttributes(templateContent, relativeFile, componentName, templateStartLine)
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
  projectRoot: string
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
      { skipTags: SVELTE_SKIP_TAGS }
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
  projectRoot: string
): string | null {
  const relativeFile = relativePath(filePath, projectRoot)
  const componentName = extractComponentName(filePath)

  const injected = injectAttributes(code, relativeFile, componentName, 1, {
    jsxMode: true,
    skipTags: JSX_SKIP_TAGS,
  })

  return injected
}

/** Tags to skip in JSX mode. Fragments have empty tag names and are handled separately. */
const JSX_SKIP_TAGS = new Set(['script', 'style'])

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
  return fileName.replace(/\.(vue|svelte|[jt]sx?)$/, '')
}

function relativePath(filePath: string, projectRoot: string): string {
  return filePath.startsWith(projectRoot)
    ? filePath.slice(projectRoot.length).replace(/^\//, '')
    : filePath
}

interface InjectOptions {
  /** Enable JSX mode: track {} brace depth, skip TS generics */
  jsxMode?: boolean
  /** Tags to skip (won't have attributes injected) */
  skipTags?: Set<string>
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

  let result = ''
  let lastIndex = 0
  let changed = false
  let i = 0

  while (i < template.length) {
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

      // In JSX mode, skip React fragments (empty tag name won't reach here,
      // but <> starts with < followed by > which isn't [a-zA-Z])
      // Skip known TypeScript generics
      if (jsxMode && TS_GENERIC_NAMES.has(tagName)) {
        // This is a TS generic like Array<string>, not a JSX tag
        // Find the closing > accounting for nested generics
        i = skipGeneric(template, i)
        continue
      }

      // In JSX mode, check if this looks like a type context
      // (preceded by : or as or extends or implements)
      if (jsxMode && isTypeContext(template, tagStart)) {
        i = skipGeneric(template, i)
        continue
      }

      // Skip tags we don't want to instrument
      if (skipTags.has(tagName) || skipTags.has(tagName.toLowerCase())) {
        i = findTagEnd(template, i, jsxMode)
        continue
      }

      // Scan past attributes to find the closing > or />
      const tagEndIndex = findTagEnd(template, i, jsxMode)

      const tagSource = template.slice(tagStart, tagEndIndex)

      // Skip if already instrumented
      if (tagSource.includes('data-annotask-file')) {
        i = tagEndIndex
        continue
      }

      // Calculate file-relative line number
      const lineInFile = templateStartLine + template.slice(0, tagStart).split('\n').length - 1

      const injection = ` data-annotask-file="${file}" data-annotask-line="${lineInFile}" data-annotask-component="${componentName}"`

      // Find the insertion point: right before '>' or '/>'
      let insertAt = tagEndIndex - 1 // the '>'
      if (insertAt > 0 && template[insertAt - 1] === '/') insertAt-- // before '/>'

      result += template.slice(lastIndex, insertAt)
      result += injection
      result += template.slice(insertAt, tagEndIndex)
      lastIndex = tagEndIndex
      changed = true
      i = tagEndIndex

      continue
    }

    i++
  }

  if (!changed) return null

  result += template.slice(lastIndex)
  return result
}

const DEFAULT_SKIP_TAGS = new Set(['script', 'style', 'template', 'slot'])

/**
 * Starting from position `i` (after the tag name), scan forward past
 * all attributes and find the closing `>`. Handles quoted strings
 * so that `>` inside `"..."`, `'...'`, or `` `...` `` doesn't end the tag.
 *
 * In JSX mode, also tracks `{}` brace depth so that `>` inside
 * JSX expression attributes (e.g., `{x > 5}`) doesn't end the tag.
 */
export function findTagEnd(template: string, i: number, jsxMode = false): number {
  let inQuote: string | null = null
  let braceDepth = 0

  while (i < template.length) {
    const ch = template[i]

    if (inQuote === '`') {
      if (ch === '`' && braceDepth === 0) {
        inQuote = null
      } else if (ch === '$' && i + 1 < template.length && template[i + 1] === '{') {
        braceDepth++
        i++ // skip past '{'
      } else if (ch === '}' && braceDepth > 0) {
        braceDepth--
      }
    } else if (inQuote) {
      if (ch === inQuote) inQuote = null
    } else {
      if (ch === '"' || ch === "'" || ch === '`') {
        inQuote = ch
      } else if (jsxMode && ch === '{') {
        braceDepth++
      } else if (jsxMode && ch === '}' && braceDepth > 0) {
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
