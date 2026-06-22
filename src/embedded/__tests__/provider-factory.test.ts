import { describe, it, expect } from 'vitest'
import { makeProvider } from '../provider-factory.js'
import { DEFAULT_PROVIDER_SETTINGS, type ProviderId, type ProviderSettings } from '../provider-config.js'

/**
 * The factory must return a distinct provider class for every value of
 * `ProviderId`. A regression here means an unhandled `switch` branch and a
 * runtime crash when the user picks that provider.
 */

const expected: Record<ProviderId, string> = {
  'claude-local': 'claude-local',
  'codex-local': 'codex-local',
  'opencode-local': 'opencode-local',
  'copilot-local': 'copilot-local',
  anthropic: 'anthropic',
  openai: 'openai',
  openrouter: 'openrouter',
  'openai-compatible': 'openai-compatible',
  paperclip: 'paperclip',
}

describe('makeProvider', () => {
  for (const [id, expectedName] of Object.entries(expected) as Array<[ProviderId, string]>) {
    it(`returns a provider for ${id}`, () => {
      const settings: ProviderSettings = {
        ...DEFAULT_PROVIDER_SETTINGS,
        activeProvider: id,
        providers: {
          ...DEFAULT_PROVIDER_SETTINGS.providers,
          // Provide minimum credentials for branches that throw at construction
          // when they're missing — keeps the factory itself unit-testable.
          anthropic: { id: 'anthropic', apiKey: 'sk-ant', model: 'claude-sonnet-4-5', effort: 'auto' },
          openai: { id: 'openai', apiKey: 'sk-openai', organization: '', model: 'gpt-5', effort: 'auto' },
          openrouter: { id: 'openrouter', apiKey: 'sk-or', baseUrl: '', model: 'openai/gpt-4o-mini', effort: 'auto' },
          'openai-compatible': {
            id: 'openai-compatible',
            endpointUrl: 'http://localhost:4096',
            apiKey: '',
            model: 'llama',
            effort: 'auto',
            label: '',
          },
          paperclip: {
            id: 'paperclip',
            companyId: 'co_test',
            apiKey: 'pc_test',
            apiBaseUrl: '',
            model: 'paperclip-default',
            effort: 'auto',
          },
        },
      }
      const provider = makeProvider(settings)
      expect(provider.name).toBe(expectedName)
    })
  }
})
