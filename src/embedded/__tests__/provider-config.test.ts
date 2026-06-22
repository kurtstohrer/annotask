import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PROVIDER_SETTINGS,
  parseProviderSettings,
  validateProviderConfig,
  isActiveProviderReady,
  redactForLogging,
  ProviderSettingsSchema,
  type ProviderSettings,
} from '../provider-config.js'

function withActiveProvider(
  patch: Partial<ProviderSettings['providers']>,
  active: ProviderSettings['activeProvider'],
): ProviderSettings {
  return {
    ...DEFAULT_PROVIDER_SETTINGS,
    activeProvider: active,
    providers: {
      ...DEFAULT_PROVIDER_SETTINGS.providers,
      ...patch,
    },
  }
}

describe('ProviderSettingsSchema defaults', () => {
  it('produces a complete default settings blob', () => {
    const d = DEFAULT_PROVIDER_SETTINGS
    expect(d.activeProvider).toBe('claude-local')
    // Auto is the default — hands-free, tasks fire on create.
    expect(d.agentMode).toBe('auto')
    expect(d.onboardingDismissed).toBe(false)
    expect(d.redactionEnabled).toBe(true)
    expect(d.eventLogEnabled).toBe(true)
    expect(d.providers.anthropic.apiKey).toBe('')
    // Empty model means "auto" — the provider picks.
    expect(d.providers.anthropic.model).toBe('')
    expect(d.providers.openai.model).toBe('')
    expect(d.providers.paperclip.companyId).toBe('')
    expect(d.providers.anthropic.effort).toBe('auto')
    expect(d.providers['claude-local'].effort).toBe('auto')
  })

  it('rejects unknown agentMode values', () => {
    const bad = ProviderSettingsSchema.safeParse({
      ...DEFAULT_PROVIDER_SETTINGS,
      agentMode: 'on' as unknown as 'auto',
    })
    expect(bad.success).toBe(false)
  })

  it('accepts each of the three agent modes', () => {
    for (const m of ['auto', 'manual', 'off'] as const) {
      const r = ProviderSettingsSchema.safeParse({ ...DEFAULT_PROVIDER_SETTINGS, agentMode: m })
      expect(r.success).toBe(true)
    }
  })
})

describe('parseProviderSettings', () => {
  it('parses a JSON string', () => {
    const blob = JSON.stringify(DEFAULT_PROVIDER_SETTINGS)
    const out = parseProviderSettings(blob)
    expect(out.activeProvider).toBe('claude-local')
  })

  it('falls back to defaults on invalid JSON', () => {
    const out = parseProviderSettings('{not valid')
    expect(out).toEqual(DEFAULT_PROVIDER_SETTINGS)
  })

  it('falls back to defaults on unknown shape', () => {
    const out = parseProviderSettings({ foo: 'bar' })
    expect(out.activeProvider).toBe('claude-local')
  })

  it('returns defaults when input is null/undefined', () => {
    expect(parseProviderSettings(null)).toEqual(DEFAULT_PROVIDER_SETTINGS)
    expect(parseProviderSettings(undefined)).toEqual(DEFAULT_PROVIDER_SETTINGS)
  })

  it('round-trips a populated config', () => {
    const populated: ProviderSettings = {
      ...DEFAULT_PROVIDER_SETTINGS,
      activeProvider: 'openai',
      providers: {
        ...DEFAULT_PROVIDER_SETTINGS.providers,
        openai: {
          id: 'openai',
          apiKey: 'sk-test',
          organization: 'org-abc',
          model: 'gpt-5',
          effort: 'high',
        },
      },
    }
    const round = parseProviderSettings(JSON.stringify(populated))
    expect(round.activeProvider).toBe('openai')
    expect(round.providers.openai.apiKey).toBe('sk-test')
    expect(round.providers.openai.organization).toBe('org-abc')
    expect(round.providers.openai.effort).toBe('high')
  })
})

describe('validateProviderConfig', () => {
  it('accepts an anthropic config with a non-empty key', () => {
    const r = validateProviderConfig({
      id: 'anthropic',
      apiKey: 'sk-ant-abc',
      model: 'claude-sonnet-4-5',
      effort: 'auto',
    })
    expect(r.ok).toBe(true)
  })

  it('accepts an openai-compatible endpoint at http://localhost', () => {
    const r = validateProviderConfig({
      id: 'openai-compatible',
      endpointUrl: 'http://localhost:4096/v1',
      apiKey: '',
      model: 'qwen2.5-coder',
      effort: 'auto',
      label: 'opencode local',
    })
    expect(r.ok).toBe(true)
  })

  it('rejects an openai-compatible endpoint with embedded credentials', () => {
    const r = validateProviderConfig({
      id: 'openai-compatible',
      endpointUrl: 'http://user:pass@localhost:4096/v1',
      apiKey: '',
      model: 'qwen2.5-coder',
      effort: 'auto',
      label: '',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.join('\n')).toMatch(/credentials/)
    }
  })

  it('rejects an openai-compatible endpoint with a non-http(s) scheme', () => {
    const r = validateProviderConfig({
      id: 'openai-compatible',
      endpointUrl: 'ftp://example.com',
      apiKey: '',
      model: 'q',
      effort: 'auto',
      label: '',
    })
    expect(r.ok).toBe(false)
  })

  it('rejects an openai-compatible endpoint that is not a URL', () => {
    const r = validateProviderConfig({
      id: 'openai-compatible',
      endpointUrl: 'localhost',
      apiKey: '',
      model: 'q',
      effort: 'auto',
      label: '',
    })
    expect(r.ok).toBe(false)
  })

  it('returns human-readable error messages with field paths', () => {
    const r = validateProviderConfig({
      id: 'openai-compatible',
      endpointUrl: '',
      apiKey: '',
      model: '',
      effort: 'auto',
      label: '',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const text = r.errors.join('\n')
      expect(text).toContain('endpointUrl')
      expect(text).toContain('model')
    }
  })
})

describe('isActiveProviderReady', () => {
  it('false on default (no credentials)', () => {
    expect(isActiveProviderReady(DEFAULT_PROVIDER_SETTINGS)).toBe(false)
  })

  it('true when Anthropic has a key', () => {
    const s = withActiveProvider(
      {
        anthropic: { id: 'anthropic', apiKey: 'sk-ant-abc', model: 'claude-sonnet-4-5', effort: 'auto' },
      },
      'anthropic',
    )
    expect(isActiveProviderReady(s)).toBe(true)
  })

  it('true when Paperclip has a company key', () => {
    const s = withActiveProvider(
      {
        paperclip: {
          id: 'paperclip',
          companyId: 'c1',
          apiKey: 'pcli_x',
          apiBaseUrl: '',
          model: 'paperclip-default',
          effort: 'auto',
        },
      },
      'paperclip',
    )
    expect(isActiveProviderReady(s)).toBe(true)
  })

  it('false for openai-compatible without endpoint url', () => {
    const s = withActiveProvider(
      {
        'openai-compatible': {
          id: 'openai-compatible',
          endpointUrl: '',
          apiKey: '',
          model: 'q',
          effort: 'auto',
          label: '',
        },
      },
      'openai-compatible',
    )
    expect(isActiveProviderReady(s)).toBe(false)
  })

  it('true for openai-compatible with endpoint url and model', () => {
    const s = withActiveProvider(
      {
        'openai-compatible': {
          id: 'openai-compatible',
          endpointUrl: 'http://localhost:4096/v1',
          apiKey: '',
          model: 'q',
          effort: 'auto',
          label: '',
        },
      },
      'openai-compatible',
    )
    expect(isActiveProviderReady(s)).toBe(true)
  })

  it('respects the local-CLI probe for claude-local', () => {
    const s = withActiveProvider({}, 'claude-local')
    expect(isActiveProviderReady(s)).toBe(false)
    expect(isActiveProviderReady(s, { 'claude-local': true })).toBe(true)
  })
})

describe('redactForLogging', () => {
  it('replaces every secret with a <set>/<unset> marker', () => {
    const populated: ProviderSettings = {
      ...DEFAULT_PROVIDER_SETTINGS,
      providers: {
        ...DEFAULT_PROVIDER_SETTINGS.providers,
        anthropic: { id: 'anthropic', apiKey: 'sk-ant-secret', model: 'm', effort: 'auto' },
        paperclip: {
          id: 'paperclip',
          companyId: 'c1',
          apiKey: 'pcli_secret',
          apiBaseUrl: '',
          model: 'm',
          effort: 'auto',
        },
      },
    }
    const out = JSON.stringify(redactForLogging(populated))
    expect(out).not.toContain('sk-ant-secret')
    expect(out).not.toContain('pcli_secret')
    expect(out).toContain('<set>')
    // Non-secret company id stays.
    expect(out).toContain('c1')
  })
})
