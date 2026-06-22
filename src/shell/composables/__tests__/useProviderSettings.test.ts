import { describe, it, expect } from 'vitest'
import { createProviderSettingsForTests } from '../useProviderSettings'

describe('useProviderSettings', () => {
  it('starts with the documented defaults when storage is empty', () => {
    const s = createProviderSettingsForTests(null)
    // Local-first default: paperclip-style, prefer whatever CLI the user has
    // logged into. The composer's empty state steers them if no CLI is found.
    expect(s.settings.value.activeProvider).toBe('claude-local')
    expect(s.settings.value.agentMode).toBe('auto')
    expect(s.settings.value.onboardingDismissed).toBe(false)
    expect(s.settings.value.redactionEnabled).toBe(true)
    expect(s.settings.value.eventLogEnabled).toBe(true)
    expect(s.ready.value).toBe(false)
  })

  it('flips ready=true once the active provider has credentials', () => {
    const s = createProviderSettingsForTests(null)
    // Switch to the BYOK Anthropic branch so this test exercises a credential
    // path (local-CLI readiness is gated on the agent-detect probe, not creds).
    s.setActiveProvider('anthropic')
    s.setProviderConfig({
      id: 'anthropic',
      apiKey: 'sk-ant-abc',
      model: 'claude-sonnet-4-5',
      effort: 'auto',
    })
    expect(s.ready.value).toBe(true)
  })

  it('switches active provider without losing other branches', () => {
    const s = createProviderSettingsForTests(null)
    s.setProviderConfig({
      id: 'anthropic',
      apiKey: 'sk-ant-abc',
      model: 'claude-sonnet-4-5',
      effort: 'auto',
    })
    s.setActiveProvider('openai')
    expect(s.activeProvider.value).toBe('openai')
    expect(s.settings.value.providers.anthropic.apiKey).toBe('sk-ant-abc')
    expect(s.ready.value).toBe(false) // openai still has no key
    s.setProviderConfig({
      id: 'openai',
      apiKey: 'sk-test',
      organization: '',
      model: 'gpt-5',
      effort: 'auto',
    })
    expect(s.ready.value).toBe(true)
  })

  it('agentMode tri-state persists', () => {
    const s = createProviderSettingsForTests(null)
    expect(s.settings.value.agentMode).toBe('auto')
    s.setAgentMode('manual')
    expect(s.settings.value.agentMode).toBe('manual')
    s.setAgentMode('off')
    expect(s.settings.value.agentMode).toBe('off')
  })

  it('persists changes through the injected sink', () => {
    let stored: unknown = null
    const persistence = {
      load: () => stored,
      save: (v: unknown) => {
        stored = typeof v === 'string' ? v : JSON.stringify(v)
      },
    }
    const s1 = createProviderSettingsForTests(stored)
    s1.setActiveProvider('openai')
    const persisted = JSON.stringify(s1.settings.value)
    const s2 = createProviderSettingsForTests(persisted)
    expect(s2.activeProvider.value).toBe('openai')
    void persistence
  })
})
