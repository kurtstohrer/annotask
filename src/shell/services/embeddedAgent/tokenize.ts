/**
 * Lightweight token estimator used by the pre-run cost meter.
 *
 * The real Anthropic provider (ANN-3) returns authoritative token counts via
 * `usage` events; this estimator is only for the *pre-run* estimate shown
 * before the user clicks Run. We deliberately avoid pulling in a tokenizer
 * library (tiktoken / @anthropic-ai/tokenizer) — they add ~MB to the shell
 * bundle to shift a $0.0003 estimate by a few percent.
 *
 * Heuristic: ~4 chars per token for English prose. We tighten to ~3.6 to
 * stay slightly conservative on code-heavy skill content, which has shorter
 * symbols and more punctuation than prose.
 */

const CHARS_PER_TOKEN = 3.6

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function estimateMessages(messages: Array<{ content: string }>): number {
  let total = 0
  for (const m of messages) total += estimateTokens(m.content)
  // Per-message framing overhead (role tags, tool wrappers). Small constant.
  return total + messages.length * 4
}
