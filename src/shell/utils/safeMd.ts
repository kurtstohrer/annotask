import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Links in rendered markdown (agent output, task descriptions, reports) should
// open in a new tab and never reverse-tabnab the shell. Registered once at
// module load — DOMPurify hooks are global, so adding it per-call would stack.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/** Parse markdown and sanitize output HTML. Use instead of raw marked.parse() + v-html. */
export function safeMd(text: string): string {
  if (!text) return ''
  return DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true }) as string)
}
