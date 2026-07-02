/**
 * CLI capability probes: the pure predicate + each CLI's configured help
 * patterns against representative help-text snippets. The probes are config-
 * as-behavior — a wrong pattern silently disables a capability for that CLI
 * (safe but wasteful) or worse, enables one the CLI lacks (the base-class
 * fallback still saves the turn, but every follow-up pays a doomed spawn).
 */
import { describe, it, expect } from 'vitest'
import { helpIndicatesCapability, __test } from '../agent-detect.js'

const { DETECTORS } = __test

const LOCAL_CLIS = ['claude-local', 'codex-local', 'opencode-local', 'copilot-local'] as const

function caps(key: typeof LOCAL_CLIS[number]) {
  return DETECTORS[key].helpProbes![0].caps
}

const CLAUDE_HELP = `Usage: claude [options] [command] [prompt]
Options:
  -p, --print                     Print response and exit
  -r, --resume [sessionId]        Resume a conversation
  -c, --continue                  Continue the most recent conversation
  --append-system-prompt <prompt> Append a system prompt to the default
  --model <model>                 Model for the current session`

const CODEX_EXEC_HELP = `Run Codex non-interactively

Usage: codex exec [OPTIONS] [PROMPT] [COMMAND]

Commands:
  resume  Resume a previous session
  help    Print this message

Arguments:
  [PROMPT]
          Initial instructions for the agent. If not provided as an argument (or if \`-\` is used),
          instructions are read from stdin`

const OPENCODE_RUN_HELP = `opencode run [message..]
Options:
  -s, --session   session id to continue
  -c, --continue  continue the last session
      --model     model to use`

const COPILOT_HELP = `Usage: copilot [options]
Options:
  -p, --prompt <text>   Run a single prompt
  --resume [sessionId]  Resume a previous session
  --allow-all-tools     Allow all tools`

describe('helpIndicatesCapability', () => {
  it('returns undefined when the probe produced no text (unknown, treated as unsupported)', () => {
    expect(helpIndicatesCapability(undefined, /--resume\b/)).toBeUndefined()
    expect(helpIndicatesCapability('', /--resume\b/)).toBeUndefined()
  })

  it('claude patterns match current help (resume + append-system-prompt) and reject bare help', () => {
    const c = caps('claude-local')
    expect(helpIndicatesCapability(CLAUDE_HELP, c.resume!)).toBe(true)
    expect(helpIndicatesCapability(CLAUDE_HELP, c.appendSystemPrompt!)).toBe(true)
    expect(helpIndicatesCapability('Usage: claude [options]\n  -p, --print', c.resume!)).toBe(false)
    expect(helpIndicatesCapability('Usage: claude [options]\n  -p, --print', c.appendSystemPrompt!)).toBe(false)
  })

  it('codex patterns match the exec resume subcommand and stdin-prompt doc', () => {
    const c = caps('codex-local')
    expect(helpIndicatesCapability(CODEX_EXEC_HELP, c.resume!)).toBe(true)
    expect(helpIndicatesCapability(CODEX_EXEC_HELP, c.stdinPrompt!)).toBe(true)
    expect(helpIndicatesCapability('Usage: codex exec [OPTIONS] [PROMPT]\n  --json', c.resume!)).toBe(false)
    expect(helpIndicatesCapability('Usage: codex exec [OPTIONS] [PROMPT]\n  --json', c.stdinPrompt!)).toBe(false)
  })

  it('opencode pattern matches the run --session flag', () => {
    const c = caps('opencode-local')
    expect(helpIndicatesCapability(OPENCODE_RUN_HELP, c.resume!)).toBe(true)
    expect(helpIndicatesCapability('opencode run [message..]\n  --model  model to use', c.resume!)).toBe(false)
  })

  it('copilot pattern matches --resume', () => {
    const c = caps('copilot-local')
    expect(helpIndicatesCapability(COPILOT_HELP, c.resume!)).toBe(true)
    expect(helpIndicatesCapability('Usage: copilot [options]\n  --allow-all-tools', c.resume!)).toBe(false)
  })

  it('every local CLI detector declares a resume probe (evenness guard)', () => {
    for (const key of LOCAL_CLIS) {
      expect(caps(key).resume, `${key} must declare a resume pattern`).toBeDefined()
    }
  })
})
