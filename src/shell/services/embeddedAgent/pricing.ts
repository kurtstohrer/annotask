/**
 * Anthropic pricing constants — single source of truth for the embedded-agent
 * cost meter. Prices are USD per 1,000,000 tokens, mirroring Anthropic's
 * published rate-card. Update this file when pricing changes; nothing else
 * needs to move.
 *
 * Cache hits are billed at 10% of the input rate; cache writes at 125%.
 */

export interface AnthropicModelPricing {
  /** USD per 1M input tokens. */
  inputPerMTok: number
  /** USD per 1M output tokens. */
  outputPerMTok: number
  /** Friendly label for the model picker. */
  label: string
}

export const ANTHROPIC_PRICING: Record<string, AnthropicModelPricing> = {
  'claude-opus-4-5': {
    label: 'Claude Opus 4.5',
    inputPerMTok: 15,
    outputPerMTok: 75,
  },
  'claude-sonnet-4-5': {
    label: 'Claude Sonnet 4.5',
    inputPerMTok: 3,
    outputPerMTok: 15,
  },
  'claude-haiku-4-5': {
    label: 'Claude Haiku 4.5',
    inputPerMTok: 1,
    outputPerMTok: 5,
  },
}

export const DEFAULT_MODEL = 'claude-sonnet-4-5'

export const CACHE_READ_RATE = 0.1
export const CACHE_WRITE_RATE = 1.25

export interface CostBreakdown {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Final USD cost, summed across all rate buckets. */
  usd: number
}

export function priceUsage(
  model: string,
  usage: {
    input: number
    output: number
    cacheRead?: number
    cacheWrite?: number
  },
): CostBreakdown {
  const rate = ANTHROPIC_PRICING[model] ?? ANTHROPIC_PRICING[DEFAULT_MODEL]
  const inputCost = (usage.input / 1_000_000) * rate.inputPerMTok
  const outputCost = (usage.output / 1_000_000) * rate.outputPerMTok
  const cacheReadCost = ((usage.cacheRead ?? 0) / 1_000_000) * rate.inputPerMTok * CACHE_READ_RATE
  const cacheWriteCost = ((usage.cacheWrite ?? 0) / 1_000_000) * rate.inputPerMTok * CACHE_WRITE_RATE
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead ?? 0,
    cacheWriteTokens: usage.cacheWrite ?? 0,
    usd: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  }
}

export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.0000'
  if (usd < 0.0001) return '<$0.0001'
  if (usd < 1) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}
