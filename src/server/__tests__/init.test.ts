import { describe, expect, it } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { __test } from '../init.js'
import type { AgentDetectSnapshot } from '../agent-detect.js'
import { BUILT_IN_PERSONAS } from '../../embedded/persona.js'

function snap(overrides: Partial<AgentDetectSnapshot> = {}): AgentDetectSnapshot {
  return {
    'claude-local': { found: false, loggedIn: false },
    'codex-local': { found: false, loggedIn: false },
    'opencode-local': { found: false, loggedIn: false },
    'copilot-local': { found: false, loggedIn: false },
    copilot: { found: false, loggedIn: false },
    openrouter: { hasEnv: false },
    ts: 1,
    ...overrides,
  }
}

describe('init CLI selection', () => {
  it('honors the requested opencode provider when multiple CLIs are ready', () => {
    const selected = __test.selectInitCli(snap({
      'claude-local': { found: true, loggedIn: true },
      'opencode-local': { found: true, loggedIn: true },
    }), 'opencode-local')

    expect(selected?.id).toBe('opencode-local')
  })

  it('uses the requested local CLI when found even if the login probe is inconclusive', () => {
    const selected = __test.selectInitCli(snap({
      'claude-local': { found: true, loggedIn: true },
      'opencode-local': { found: true, loggedIn: false },
    }), 'opencode-local')

    expect(selected?.id).toBe('opencode-local')
  })

  it('does not silently switch to Claude when the requested CLI is missing', () => {
    const selected = __test.selectInitCli(snap({
      'claude-local': { found: true, loggedIn: true },
      'opencode-local': { found: false, loggedIn: false },
    }), 'opencode-local')

    expect(selected).toBeNull()
  })
})

async function withTempAgentsFile(
  contents: unknown,
  fn: (filePath: string) => Promise<void>,
): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'annotask-init-test-'))
  const filePath = path.join(dir, 'agents.json')
  if (contents != null) {
    await fsp.writeFile(filePath, JSON.stringify(contents, null, 2), 'utf-8')
  }
  try {
    await fn(filePath)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

describe('enforceSelectedRuntime', () => {
  it('overwrites pre-existing Claude provider/model/effort with the selected runtime', async () => {
    const existing = {
      version: 1,
      agents: {
        general:     { projectDirections: 'pre-existing general directions',     providerId: 'claude-local', model: 'sonnet', effort: 'medium' },
        designer:    { projectDirections: 'pre-existing designer directions',    providerId: 'claude-local', model: 'sonnet', effort: 'medium' },
        a11y:        { projectDirections: 'pre-existing a11y directions',        providerId: 'claude-local', model: 'opus',   effort: 'high'   },
        'bug-hunter':{ projectDirections: 'pre-existing bug-hunter directions',  providerId: 'claude-local', model: 'opus',   effort: 'high'   },
      },
    }

    await withTempAgentsFile(existing, async (filePath) => {
      await __test.enforceSelectedRuntime({
        filePath,
        providerId: 'opencode-local',
        model: 'openai/gpt-5.5',
        effort: 'high',
        fallbackRoleText: true,
      })

      const written = JSON.parse(await fsp.readFile(filePath, 'utf-8'))
      for (const persona of BUILT_IN_PERSONAS) {
        const entry = written.agents[persona.id]
        expect(entry.providerId).toBe('opencode-local')
        expect(entry.model).toBe('openai/gpt-5.5')
        expect(entry.effort).toBe('high')
        // Pre-existing directions are preserved.
        expect(entry.projectDirections).toBe(`pre-existing ${persona.id} directions`)
      }
    })
  })

  it('preserves custom (non-built-in) personas verbatim', async () => {
    const existing = {
      version: 1,
      agents: {
        general:        { projectDirections: 'd', providerId: 'claude-local', model: 'sonnet', effort: 'medium' },
        'copy-editor':  { projectDirections: 'custom directions', providerId: 'openai', model: 'gpt-5', effort: 'low' },
      },
    }

    await withTempAgentsFile(existing, async (filePath) => {
      await __test.enforceSelectedRuntime({
        filePath,
        providerId: 'opencode-local',
        model: 'openai/gpt-5.5',
        effort: 'high',
        fallbackRoleText: false,
      })

      const written = JSON.parse(await fsp.readFile(filePath, 'utf-8'))
      expect(written.agents['copy-editor']).toEqual({
        projectDirections: 'custom directions',
        providerId: 'openai',
        model: 'gpt-5',
        effort: 'low',
      })
      // And the built-ins were rewritten to the selected runtime.
      expect(written.agents.general.providerId).toBe('opencode-local')
      expect(written.agents.general.model).toBe('openai/gpt-5.5')
      expect(written.agents.general.effort).toBe('high')
    })
  })

  it('seeds role-text fallback when projectDirections is empty and fallbackRoleText is true', async () => {
    await withTempAgentsFile(null, async (filePath) => {
      const result = await __test.enforceSelectedRuntime({
        filePath,
        providerId: 'codex-local',
        model: 'gpt-5',
        effort: 'medium',
        fallbackRoleText: true,
      })
      expect(result.backfilled).toBe(BUILT_IN_PERSONAS.length)
      const written = JSON.parse(await fsp.readFile(filePath, 'utf-8'))
      for (const persona of BUILT_IN_PERSONAS) {
        expect(written.agents[persona.id].projectDirections).toBe(persona.roleDirections)
        expect(written.agents[persona.id].providerId).toBe('codex-local')
        expect(written.agents[persona.id].model).toBe('gpt-5')
        expect(written.agents[persona.id].effort).toBe('medium')
      }
    })
  })

  it('leaves projectDirections empty when fallbackRoleText is false', async () => {
    await withTempAgentsFile(null, async (filePath) => {
      await __test.enforceSelectedRuntime({
        filePath,
        providerId: 'opencode-local',
        model: 'openai/gpt-5.5',
        effort: 'high',
        fallbackRoleText: false,
      })
      const written = JSON.parse(await fsp.readFile(filePath, 'utf-8'))
      for (const persona of BUILT_IN_PERSONAS) {
        expect(written.agents[persona.id].projectDirections).toBe('')
        expect(written.agents[persona.id].providerId).toBe('opencode-local')
      }
    })
  })
})

describe('buildAgentConfigsPrompt', () => {
  const prompt = __test.buildAgentConfigsPrompt({
    projectRoot: '/tmp/example',
    framework: { name: 'vue', version: '3.5', styling: ['scoped-css'] },
    totalPersonas: BUILT_IN_PERSONAS.length,
  })

  it('tells the CLI it may only edit projectDirections', () => {
    expect(prompt).toMatch(/only edit the `projectDirections`/i)
    expect(prompt).toMatch(/providerId.*model.*effort.*owned by Annotask/i)
  })

  it('does not ask the CLI to pick a model per persona', () => {
    // Forbid prose that would invite the CLI to pick or write models/effort.
    expect(prompt).not.toMatch(/pick (a|an|the)? ?model/i)
    expect(prompt).not.toMatch(/choose (a|an|the)? ?model/i)
    expect(prompt).not.toMatch(/select (a|an|the)? ?model/i)
    expect(prompt).not.toMatch(/decide (the|which)? ?model/i)
    expect(prompt).not.toMatch(/pick (a|an|the)? ?effort/i)
    expect(prompt).not.toMatch(/choose (a|an|the)? ?effort/i)
    expect(prompt).not.toMatch(/select (a|an|the)? ?effort/i)
    expect(prompt).not.toMatch(/assign (a|an|the)? ?model/i)
  })

  it('does not embed concrete provider/model/effort values that could be copied', () => {
    // Older versions wrote out the resolved values for the CLI to "keep" — a
    // shape that invited the CLI to echo them back as if it had chosen them.
    expect(prompt).not.toMatch(/providerId=opencode-local/)
    expect(prompt).not.toMatch(/model="openai\/gpt-5\.5"/)
    expect(prompt).not.toMatch(/effort=high/)
  })
})
