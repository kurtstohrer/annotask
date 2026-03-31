export function stripMarkdown(text: string, maxLen = 80): string {
  let s = text
    .replace(/```[\s\S]*?```/g, '')       // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')          // inline code
    .replace(/!\[.*?\]\(.*?\)/g, '')      // images
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')// links → label
    .replace(/^#{1,6}\s+/gm, '')          // headings
    .replace(/(\*\*|__)(.*?)\1/g, '$2')   // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')      // italic
    .replace(/^[\s]*[-*+]\s+/gm, '')      // unordered list markers
    .replace(/^[\s]*\d+\.\s+/gm, '')      // ordered list markers
    .replace(/^>\s?/gm, '')               // blockquotes
    .replace(/\n+/g, ' ')                 // newlines → space
    .replace(/\s+/g, ' ')                 // collapse whitespace
    .trim()
  if (s.length > maxLen) s = s.slice(0, maxLen).trimEnd() + '...'
  return s
}
