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
    expect(d.activeProvider).toBe('anthropic')
    expect(d.perConversationCapUsd).toBe(0.5)
    expect(d.redactionEnabled).toBe(true)
    expect(d.eventLogEnabled).toBe(true)
    expect(d.providers.anthropic.apiKey).toBe('')
    expect(d.providers.anthropic.model).toBe('claude-sonnet-4-5')
    expect(d.providers.openai.model).toBe('gpt-5')
    expect(d.providers.copilot.oauthToken).toBe('')
    expect(d.providers.paperclip.companyId).toBe('')
  })

  it('rejects a non-positive perConversationCapUsd', () => {
    const bad = ProviderSettingsSchema.safeParse({
      ...DEFAULT_PROVIDER_SETTINGS,
      perConversationCapUsd: -1,
    })
    expect(bad.success).toBe(false)
  })
})

describe('parseProviderSettings', () => {
  it('parses a JSON string', () => {
    const blob = JSON.stringify(DEFAULT_PROVIDER_SETTINGS)
    const out = parseProviderSettings(blob)
    expect(out.activeProvider).toBe('anthropic')
  })

  it('falls back to defaults on invalid JSON', () => {
    const out = parseProviderSettings('{not valid')
    expect(out).toEqual(DEFAULT_PROVIDER_SETTINGS)
  })

  it('falls back to defaults on unknown shape', () => {
    const out = parseProviderSettings({ foo: 'bar' })
    expect(out.activeProvider).toBe('anthropic')
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
        },
      },
    }
    const round = parseProviderSettings(JSON.stringify(populated))
    expect(round.activeProvider).toBe('openai')
    expect(round.providers.openai.apiKey).toBe('sk-test')
    expect(round.providers.openai.organization).toBe('org-abc')
  })
})

describe('validateProviderConfig', () => {
  it('accepts an anthropic config with a non-empty key', () => {
    const r = validateProviderConfig({
      id: 'anthropic',
      apiKey: 'sk-ant-abc',
      model: 'claude-sonnet-4-5',
    })
    expect(r.ok).toBe(true)
  })

  it('accepts an openai-compatible endpoint at http://localhost', () => {
    const r = validateProviderConfig({
      id: 'openai-compatible',
      endpointUrl: 'http://localhost:4096/v1',
      apiKey: '',
      model: 'qwen2.5-coder',
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
        anthropic: { id: 'anthropic', apiKey: 'sk-ant-abc', model: 'claude-sonnet-4-5' },
      },
      'anthropic',
    )
    expect(isActiveProviderReady(s)).toBe(true)
  })

  it('true when Copilot has an OAuth token', () => {
    const s = withActiveProvider(
      {
        copilot: { id: 'copilot', oauthToken: 'gho_x', model: 'gpt-5' },
      },
      'copilot',
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
          label: '',
        },
      },
      'openai-compatible',
    )
    expect(isActiveProviderReady(s)).toBe(true)
  })
})

describe('redactForLogging', () => {
  it('replaces every secret with a <set>/<unset> marker', () => {
    const populated: ProviderSettings = {
      ...DEFAULT_PROVIDER_SETTINGS,
      providers: {
        ...DEFAULT_PROVIDER_SETTINGS.providers,
        anthropic: { id: 'anthropic', apiKey: 'sk-ant-secret', model: 'm' },
        copilot: { id: 'copilot', oauthToken: 'gho_secret', model: 'm' },
        paperclip: {
          id: 'paperclip',
          companyId: 'c1',
          apiKey: 'pcli_secret',
          apiBaseUrl: '',
          model: 'm',
        },
      },
    }
    const out = JSON.stringify(redactForLogging(populated))
    expect(out).not.toContain('sk-ant-secret')
    expect(out).not.toContain('gho_secret')
    expect(out).not.toContain('pcli_secret')
    expect(out).toContain('<set>')
    // Non-secret company id stays.
    expect(out).toContain('c1')
  })
})
