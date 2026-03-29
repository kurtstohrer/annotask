/**
 * Vue SFC template transform.
 *
 * Injects data-annotask-file, data-annotask-line, and data-annotask-component
 * attributes on every element in Vue SFC templates at compile time.
 *
 * Strategy: We use Vite's `transform` hook on .vue files. After
 * @vitejs/plugin-vue compiles the SFC, the template is turned into
 * render function calls like `_createElementVNode("div", { ... })`.
 *
 * Instead of post-processing compiled output (fragile), we use
 * @vue/compiler-sfc to parse the raw SFC, walk the template AST,
 * and inject attributes directly into the template source before
 * the Vue plugin compiles it. We do this via Vite's `enforce: 'pre'`
 * so our transform runs BEFORE @vitejs/plugin-vue.
 */

import type { NodeTypes } from '@vue/compiler-core'

interface TemplateNode {
  type: number
  tag?: string
  props: Array<{
    type: number
    name: string
    value?: { content: string }
    loc: { start: { offset: number }; end: { offset: number } }
  }>
  children?: TemplateNode[]
  loc: {
    start: { offset: number; line: number; column: number }
    end: { offset: number; line: number; column: number }
    source: string
  }
}

// Node types from @vue/compiler-core
const ELEMENT = 1
const ATTRIBUTE = 6

/**
 * Transform an SFC's raw source to inject data-annotask-* attributes
 * on every element in the <template> block.
 */
export function transformSFC(
  code: string,
  filePath: string,
  projectRoot: string
): string | null {
  // Quick bail: not a Vue SFC with a template
  if (!code.includes('<template')) return null

  // Find the template block boundaries
  const templateMatch = code.match(/<template(\s[^>]*)?>/)
  if (!templateMatch) return null

  const templateStart = code.indexOf(templateMatch[0])
  const templateEnd = code.lastIndexOf('</template>')
  if (templateEnd === -1) return null

  // The content between <template> and </template>
  const templateOpenTagEnd = templateStart + templateMatch[0].length
  const templateContent = code.slice(templateOpenTagEnd, templateEnd)

  // Calculate relative file path
  const relativeFile = filePath.startsWith(projectRoot)
    ? filePath.slice(projectRoot.length).replace(/^\//, '')
    : filePath

  // Extract the component name from the file path
  const componentName = extractComponentName(filePath)

  // Calculate the 1-based line number where template content begins in the file
  const templateStartLine = code.slice(0, templateOpenTagEnd).split('\n').length

  // Parse the template to find all element open tags and inject attributes.
  // We work on the raw template string to avoid needing the full Vue compiler
  // as a runtime dependency. We find every opening tag and inject attributes
  // right before the closing `>`.
  const injected = injectAttributes(templateContent, relativeFile, componentName, templateStartLine)

  if (!injected) return null

  return code.slice(0, templateOpenTagEnd) + injected + code.slice(templateEnd)
}

function extractComponentName(filePath: string): string {
  const fileName = filePath.split('/').pop() || ''
  return fileName.replace(/\.vue$/, '')
}

/**
 * Walk through template HTML and inject data-annotask-* attributes on every
 * element's opening tag.
 *
 * Uses a character-level scanner that is quote-aware, so `>` inside
 * attribute values (e.g., `:class="{ hot: x > 100 }"`) does not
 * prematurely close the tag.
 */
function injectAttributes(
  template: string,
  file: string,
  componentName: string,
  templateStartLine: number
): string | null {
  const skipTags = new Set(['script', 'style', 'template', 'slot'])
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

      // Read tag name
      const nameStart = i
      while (i < template.length && /[a-zA-Z0-9-]/.test(template[i])) i++
      const tagName = template.slice(nameStart, i)

      // Skip tags we don't want to instrument
      if (skipTags.has(tagName.toLowerCase())) {
        // Advance past this tag's closing >
        i = findTagEnd(template, i)
        continue
      }

      // Scan past attributes to find the closing > or />
      // This is quote-aware: we track when we're inside " or ' strings
      const attrsStart = i
      i = findTagEnd(template, i)
      const tagEndIndex = i // points one past the '>'

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

      continue
    }

    i++
  }

  if (!changed) return null

  result += template.slice(lastIndex)
  return result
}

/**
 * Starting from position `i` (after the tag name), scan forward past
 * all attributes and find the closing `>`. Handles quoted strings
 * so that `>` inside `"..."`, `'...'`, or `` `...` `` doesn't end the tag.
 * Backtick template literals track `${...}` interpolation depth.
 * Returns the index one past the closing `>`.
 */
function findTagEnd(template: string, i: number): number {
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
      } else if (ch === '>') {
        return i + 1
      }
    }
    i++
  }

  return i
}
