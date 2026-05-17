/**
 * Server-side agent-models hardening checks.
 *
 * The live network probes (opencode subprocess) are not run here — they're
 * covered by the on-demand smoke tests. We exercise the pure parsers and the
 * cache behavior instead, which is where the regressions that triggered this
 * hardening showed up:
 *   - opencode emitting ANSI escapes inside a TTY proxy
 *   - opencode prefixing the active row with `→` / `*` / bullet glyphs
 *   - `refresh: true` failing to bypass the 5-minute in-process cache
 */

import { describe, it, expect } from 'vitest'
import {
  parseOpenCodeModels,
  parseCodexModelsCache,
  listAgentModels,
  invalidateAgentModels,
} from '../agent-models.js'

describe('parseOpenCodeModels', () => {
  it('parses plain provider/model lines', () => {
    const out = parseOpenCodeModels(
      'anthropic/claude-sonnet-4-6\nopenai/gpt-5.4\nopenai/gpt-4o-mini\n',
    )
    expect(out.map(m => m.id)).toEqual([
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-5.4',
      'openai/gpt-4o-mini',
    ])
    expect(out.every(m => m.source === 'discovered')).toBe(true)
  })

  it('strips ANSI control sequences before parsing', () => {
    const ansi = '\x1B[2manthropic/claude-sonnet-4-6\x1B[0m\n\x1B[32m→\x1B[0m openai/gpt-5.4\n'
    const out = parseOpenCodeModels(ansi)
    expect(out.map(m => m.id)).toEqual([
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-5.4',
    ])
  })

  it('drops leading decoration characters from the active row', () => {
    const out = parseOpenCodeModels(
      '> anthropic/claude-sonnet-4-6\n  openai/gpt-5.4\n* openai/gpt-4o-mini  (active)\n',
    )
    expect(out.map(m => m.id)).toEqual([
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-5.4',
      'openai/gpt-4o-mini',
    ])
  })

  it('preserves multi-segment ids like vllm/Qwen/Model-7B', () => {
    const out = parseOpenCodeModels('vllm/Qwen/Qwen2.5-7B-Instruct-AWQ\n')
    expect(out[0].id).toBe('vllm/Qwen/Qwen2.5-7B-Instruct-AWQ')
  })

  it('accepts JSON output from a future opencode build', () => {
    const json = JSON.stringify({
      models: [
        { id: 'anthropic/claude-sonnet-4-6', label: 'Sonnet 4.6' },
        'openai/gpt-5.4',
      ],
    })
    const out = parseOpenCodeModels(json)
    expect(out.map(m => m.id)).toEqual([
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-5.4',
    ])
  })

  it('dedupes repeated entries', () => {
    const out = parseOpenCodeModels(
      'anthropic/claude-sonnet-4-6\nanthropic/claude-sonnet-4-6\nopenai/gpt-5.4\n',
    )
    expect(out.map(m => m.id)).toEqual([
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-5.4',
    ])
  })

  it('ignores blank input', () => {
    expect(parseOpenCodeModels('')).toEqual([])
    expect(parseOpenCodeModels('   \n  \n')).toEqual([])
  })
})

describe('parseCodexModelsCache', () => {
  it('reads slug + display_name from the codex cache', () => {
    const raw = JSON.stringify({
      models: [
        { slug: 'gpt-5.4', display_name: 'GPT-5.4' },
        { slug: 'gpt-5.2' },
        { /* bad */ },
      ],
    })
    const out = parseCodexModelsCache(raw)
    expect(out).toEqual([
      { id: 'gpt-5.4', label: 'GPT-5.4', source: 'discovered' },
      { id: 'gpt-5.2', label: 'gpt-5.2', source: 'discovered' },
    ])
  })
})

describe('listAgentModels cache behavior', () => {
  it('returns the static catalog (Auto + canonical ids, no error) for providers with no probe', async () => {
    invalidateAgentModels()
    const catalog = await listAgentModels('anthropic')
    expect(catalog.discovered).toBe(false)
    expect(catalog.error).toBeUndefined()
    expect(catalog.models[0].id).toBe('') // Auto option
    expect(catalog.models.length).toBeGreaterThan(1)
    expect(catalog.models.slice(1).every((m) => m.source === 'static')).toBe(true)
    // Sanity: the canonical Anthropic ids are present.
    expect(catalog.models.map((m) => m.id)).toContain('claude-opus-4-7')
  })

  it('claude-local serves opus/sonnet/haiku aliases as a static catalog', async () => {
    invalidateAgentModels()
    const catalog = await listAgentModels('claude-local')
    const ids = catalog.models.map((m) => m.id)
    expect(ids).toEqual(['', 'opus', 'sonnet', 'haiku'])
    expect(catalog.error).toBeUndefined()
    expect(catalog.discovered).toBe(false)
  })

  it('returns a copilot-local-specific error explaining the CLI has no headless model list', async () => {
    invalidateAgentModels()
    // copilot-local intentionally does NOT probe the HTTP /models endpoint
    // — the CLI's --model flag rejects those ids. Verify we surface that
    // distinction in the error so the user knows where to look.
    const catalog = await listAgentModels('copilot-local')
    expect(catalog.discovered).toBe(false)
    expect(catalog.models).toHaveLength(1)
    expect(catalog.error).toBeTruthy()
    expect(catalog.error).toMatch(/Copilot CLI doesn't expose a model list/i)
    expect(catalog.error).toMatch(/\/model/)
  })

  it('refresh: true forces a fresh fetch', async () => {
    invalidateAgentModels()
    const first = await listAgentModels('anthropic')
    // Inject a timestamp far enough in the future to detect a fresh probe.
    const before = first.cachedAt
    // Default call hits the cache and returns the same cachedAt.
    const cached = await listAgentModels('anthropic')
    expect(cached.cachedAt).toBe(before)
    // refresh: true bypasses the cache and re-stamps cachedAt.
    await new Promise((r) => setTimeout(r, 5))
    const refreshed = await listAgentModels('anthropic', { refresh: true })
    expect(refreshed.cachedAt).toBeGreaterThan(before)
  })
})
