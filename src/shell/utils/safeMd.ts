import { marked } from 'marked'
import DOMPurify from 'dompurify'

/** Parse markdown and sanitize output HTML. Use instead of raw marked.parse() + v-html. */
export function safeMd(text: string): string {
  if (!text) return ''
  return DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true }) as string)
}
