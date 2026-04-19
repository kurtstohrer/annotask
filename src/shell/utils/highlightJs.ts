/**
 * Tiny regex-based JS/TS tokenizer for the Data view's definition excerpts.
 * Not a full highlighter — just enough to visually distinguish keywords,
 * types, strings, numbers, and comments in a short code excerpt.
 */

export type TokenClass =
  | 'keyword'
  | 'type'
  | 'string'
  | 'number'
  | 'comment'
  | 'boolean'
  | 'null'
  | 'punct'
  | 'ident'
  | 'text'

export interface Token {
  text: string
  cls: TokenClass
}

const KEYWORDS = new Set([
  'export', 'import', 'from', 'default', 'const', 'let', 'var',
  'function', 'return', 'async', 'await',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'class', 'extends', 'implements', 'interface', 'type', 'enum',
  'as', 'in', 'of', 'new', 'this', 'super', 'typeof', 'instanceof', 'void',
  'throw', 'try', 'catch', 'finally', 'yield', 'delete',
  'public', 'private', 'protected', 'readonly', 'static', 'abstract',
  'declare', 'namespace', 'module',
])

const TOKEN_RE = new RegExp(
  [
    '(?<block_comment>\\/\\*[\\s\\S]*?\\*\\/)',
    '(?<line_comment>\\/\\/[^\\n]*)',
    '(?<tstring>`(?:[^`\\\\]|\\\\.)*`)',
    '(?<dstring>"(?:[^"\\\\]|\\\\.)*")',
    '(?<sstring>\'(?:[^\'\\\\]|\\\\.)*\')',
    '(?<number>\\b\\d+(?:\\.\\d+)?\\b)',
    '(?<ident>[A-Za-z_$][\\w$]*)',
    '(?<punct>[{}()\\[\\],.;:<>=+\\-*/%!&|^~?@#]+)',
    '(?<ws>\\s+)',
  ].join('|'),
  'g',
)

export function tokenize(code: string): Token[] {
  const out: Token[] = []
  if (!code) return out
  let m: RegExpExecArray | null
  let lastIndex = 0
  TOKEN_RE.lastIndex = 0
  // eslint-disable-next-line no-cond-assign
  while ((m = TOKEN_RE.exec(code)) !== null) {
    // Capture leading untokenized gap (shouldn't happen with \s+ catch-all, safety net).
    if (m.index > lastIndex) {
      out.push({ text: code.slice(lastIndex, m.index), cls: 'text' })
    }
    const g = (m.groups || {}) as Record<string, string | undefined>
    if (g.block_comment || g.line_comment) {
      out.push({ text: m[0], cls: 'comment' })
    } else if (g.tstring || g.dstring || g.sstring) {
      out.push({ text: m[0], cls: 'string' })
    } else if (g.number) {
      out.push({ text: m[0], cls: 'number' })
    } else if (g.ident) {
      const id = m[0]
      if (KEYWORDS.has(id)) out.push({ text: id, cls: 'keyword' })
      else if (id === 'true' || id === 'false') out.push({ text: id, cls: 'boolean' })
      else if (id === 'null' || id === 'undefined') out.push({ text: id, cls: 'null' })
      else if (/^[A-Z]/.test(id)) out.push({ text: id, cls: 'type' })
      else out.push({ text: id, cls: 'ident' })
    } else if (g.punct) {
      out.push({ text: m[0], cls: 'punct' })
    } else {
      out.push({ text: m[0], cls: 'text' })
    }
    lastIndex = TOKEN_RE.lastIndex
  }
  if (lastIndex < code.length) {
    out.push({ text: code.slice(lastIndex), cls: 'text' })
  }
  return out
}
