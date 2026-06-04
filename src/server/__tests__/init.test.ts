import { describe, expect, it } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { __test, createInitRunner, buildInitCliInvocation } from '../init.js'
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

describe('buildInitCliInvocation — per-CLI init argv', () => {
  const base = { skillBody: 'SKILL', userMessage: 'do the init' }

  it('codex includes --skip-git-repo-check (regression: codex refuses non-git dirs without it)', () => {
    const { args } = buildInitCliInvocation({ bin: 'codex', ...base })
    expect(args).toEqual(expect.arrayContaining(['exec', '--json', '--full-auto', '--skip-git-repo-check']))
    // The prompt rides as the trailing positional after `--`.
    expect(args[args.length - 2]).toBe('--')
  })

  it('claude pipes the skill+prompt on stdin with bypass flags', () => {
    const { args, stdin } = buildInitCliInvocation({ bin: 'claude', ...base })
    expect(args).toEqual(expect.arrayContaining(['--print', '--output-format', 'stream-json', '--dangerously-skip-permissions']))
    expect(stdin).toContain('SKILL')
    expect(stdin).toContain('do the init')
  })

  it('copilot keeps --allow-all-tools and passes the prompt via -p', () => {
    const { args } = buildInitCliInvocation({ bin: 'copilot', ...base })
    expect(args).toEqual(expect.arrayContaining(['--output-format', 'json', '--allow-all-tools', '-p']))
  })

  it('opencode uses run --format=json with the bypass toggle', () => {
    const { args } = buildInitCliInvocation({ bin: 'opencode', ...base })
    expect(args).toEqual(expect.arrayContaining(['run', '--print-logs', '--format=json', '--dangerously-skip-permissions', '--']))
  })

  it('threads model + reasoning effort when provided (codex)', () => {
    const { args } = buildInitCliInvocation({ bin: 'codex', model: 'gpt-5.4', effort: 'high', ...base })
    expect(args).toEqual(expect.arrayContaining(['--model', 'gpt-5.4', '-c', 'model_reasoning_effort=high']))
  })

  it("omits effort flags for 'auto'/'minimal'", () => {
    const { args } = buildInitCliInvocation({ bin: 'codex', effort: 'auto', ...base })
    expect(args).not.toContain('-c')
  })
})

describe('init CLI selection', () => {
  it('honors the requested opencode provider when multiple CLIs are ready', () => {
    const selected = __test.selectInitCli(snap({
      'claude-local': { found: true, loggedIn: true },
      'opencode-local': { found: true, loggedIn: true },
    }), 'opencode-local')

    expect(selected?.id).toBe('opencode-local')
  })

  it('rejects the requested local CLI when found but not logged in', () => {
    const selected = __test.selectInitCli(snap({
      'claude-local': { found: true, loggedIn: true },
      'opencode-local': { found: true, loggedIn: false },
    }), 'opencode-local')

    expect(selected).toBeNull()
  })

  it('surfaces a targeted message when the requested CLI is found but not logged in', () => {
    const s = snap({
      'opencode-local': { found: true, loggedIn: false },
    })
    const reason = __test.initCliNotReadyReason(s, 'opencode-local')
    expect(reason).toMatch(/installed but not logged in/)
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

describe('detectFatalStderrLine', () => {
  it('returns null for non-error opencode log lines', () => {
    expect(__test.detectFatalStderrLine('opencode', 'INFO  2026-... service=default loading')).toBeNull()
    expect(__test.detectFatalStderrLine('opencode', '')).toBeNull()
  })

  it('flags ConnectionRefused on the configured LLM provider', () => {
    const line = 'ERROR 2026-05-20T19:34:07 +1ms service=llm providerID=vllm modelID=Qwen/Qwen2.5-7B-Instruct-AWQ error={"error":{"name":"AI_APICallError","cause":{"code":"ConnectionRefused","path":"http://127.0.0.1:8010/v1/chat/completions"}}}'
    const result = __test.detectFatalStderrLine('opencode', line)
    expect(result).toMatch(/LLM provider unreachable/)
    expect(result).toContain('ConnectionRefused')
    expect(result).toContain('http://127.0.0.1:8010/v1/chat/completions')
  })

  it('flags AI_APICallError without a structured cause', () => {
    const line = 'ERROR 2026-... service=llm error={"error":{"name":"AI_APICallError"}}'
    const result = __test.detectFatalStderrLine('opencode', line)
    expect(result).toMatch(/LLM call failed: AI_APICallError/)
  })

  it('ignores non-llm ERROR lines (e.g. file watchers) that the CLI recovers from', () => {
    const line = 'ERROR 2026-... service=file.watcher backend=inotify path=/foo failed to watch'
    expect(__test.detectFatalStderrLine('opencode', line)).toBeNull()
  })

  it('only inspects opencode for now — other CLIs return null', () => {
    const line = 'ERROR service=llm something broken'
    expect(__test.detectFatalStderrLine('claude', line)).toBeNull()
    expect(__test.detectFatalStderrLine('codex', line)).toBeNull()
    expect(__test.detectFatalStderrLine('copilot', line)).toBeNull()
  })
})

describe('initRunner.reset', () => {
  function makeRunner() {
    const broadcasts: Array<{ event: string; data: any }> = []
    const runner = createInitRunner({
      projectRoot: os.tmpdir(),
      broadcast: (event, data) => broadcasts.push({ event, data }),
      agentDetect: { detect: async () => snap(), invalidate: () => {} } as any,
    })
    return { runner, broadcasts }
  }

  it('drops step state and broadcasts a fresh progress event', () => {
    const { runner, broadcasts } = makeRunner()
    // Pre-load state as if a prior run completed: mutate via getState→start is
    // hard, but reset() works on the closure state directly, so it's enough to
    // call reset and observe the broadcast shape from a known starting point.
    const before = runner.getState()
    expect(before.steps.length).toBeGreaterThan(0)
    expect(before.steps.every(s => s.status === 'pending')).toBe(true)

    const after = runner.reset()
    expect(after.running).toBe(false)
    expect(after.steps.every(s => s.status === 'pending')).toBe(true)
    expect(after.tokenUsage).toBeUndefined()
    expect(after.result).toBeUndefined()

    // Most-recent broadcast is the post-reset progress.
    const last = broadcasts.at(-1)
    expect(last?.event).toBe('init:progress')
  })

  it('is a no-op while a run is in flight (start() set running:true)', async () => {
    // We can't easily run the full pipeline in unit tests, but we can verify
    // the running-guard by stubbing the public surface: start() sets running
    // synchronously, so calling reset() right after must keep that flag.
    const { runner } = makeRunner()
    const startedState = runner.start({})
    expect(startedState.running).toBe(true)
    const afterReset = runner.reset()
    // Running flag preserved — reset bailed.
    expect(afterReset.running).toBe(true)
    runner.cancel()
  })
})

describe('extractTextFromLine — opencode shapes', () => {
  // Regression: prior to the v1.14+ fix the init pipeline only matched
  // {type:'message', content:'...'}, so the wizard streamed zero agent
  // lines whenever opencode emitted the modern part-wrapped envelope.
  it('parses opencode v1.14+ text events with nested part.text', () => {
    const line = '{"type":"text","sessionID":"s1","part":{"type":"text","text":"Hello to you"}}'
    expect(__test.extractTextFromLine('opencode', line)).toBe('Hello to you')
  })

  it('parses opencode legacy top-level text', () => {
    const line = '{"type":"text","text":"hi"}'
    expect(__test.extractTextFromLine('opencode', line)).toBe('hi')
  })

  it('parses opencode legacy message envelope', () => {
    const line = '{"type":"message","content":"hello there"}'
    expect(__test.extractTextFromLine('opencode', line)).toBe('hello there')
  })

  it('returns null for opencode step_start / step_finish events (no displayable text)', () => {
    expect(__test.extractTextFromLine('opencode', '{"type":"step_start","part":{}}')).toBeNull()
    expect(__test.extractTextFromLine('opencode', '{"type":"step_finish","part":{"tokens":{"input":1,"output":2}}}')).toBeNull()
  })

  it('parses copilot assistant.message cumulative content (init log, not chunked deltas)', () => {
    // Regression: previously read assistant.message_delta.deltaContent, which
    // turned one paragraph into ~50 newline-separated word fragments in the
    // wizard's agent-output panel ("I'll initialize Annotask\n\n by\n\n
    // scanning the c\n\nodebase…").
    const finalMsg = '{"type":"assistant.message","data":{"content":"I\'ll initialize Annotask by scanning the codebase.","outputTokens":21}}'
    expect(__test.extractTextFromLine('copilot', finalMsg)).toBe("I'll initialize Annotask by scanning the codebase.")
  })

  it('ignores copilot per-chunk deltas to avoid mid-word newlines', () => {
    const delta = '{"type":"assistant.message_delta","data":{"deltaContent":"I\'ll initialize"}}'
    expect(__test.extractTextFromLine('copilot', delta)).toBeNull()
  })

  it('still parses opencode step_finish for usage tokens', () => {
    const line = '{"type":"step_finish","part":{"tokens":{"input":1735,"output":9,"cache":{"read":6656,"write":0}}}}'
    const u = __test.extractUsageFromLine('opencode', line)
    expect(u).not.toBeNull()
    expect(u?.inputTokens).toBe(1735)
    expect(u?.outputTokens).toBe(9)
    expect(u?.cacheReadTokens).toBe(6656)
  })
})
