/**
 * Shared env-flag contract for live-CLI test suites.
 *
 * Two suites consume this:
 *   - `cli-providers-live.test.ts` (chat streaming smoke)
 *   - `../../server/__tests__/init-cli-matrix-stress.test.ts` (init pipeline)
 *
 * Env vars:
 *   ANNOTASK_LIVE_CLI=1        — enable the suite at all
 *   ANNOTASK_LIVE_ONLY=csv     — optional filter, short or long names
 *   ANNOTASK_LIVE_<CLI>_MODEL  — per-CLI model override (see MODEL_CONFIG)
 *
 * The defaults below match what the live chat suite shipped with — keep
 * them in sync with the four embedded providers if you change them.
 */

export type LiveProviderKey =
  | 'claude-local'
  | 'opencode-local'
  | 'codex-local'
  | 'copilot-local'

interface ModelEntry {
  default: string
  env: string
}

export const MODEL_CONFIG: Record<LiveProviderKey, ModelEntry> = {
  'claude-local':   { default: 'claude-sonnet-4-6',      env: 'ANNOTASK_LIVE_CLAUDE_MODEL' },
  'opencode-local': { default: 'github-copilot/gpt-5.4', env: 'ANNOTASK_LIVE_OPENCODE_MODEL' },
  'codex-local':    { default: 'gpt-5.4',                env: 'ANNOTASK_LIVE_CODEX_MODEL' },
  'copilot-local':  { default: 'gpt-5.3-codex',          env: 'ANNOTASK_LIVE_COPILOT_MODEL' },
}

export const LIVE_CLI_ENABLED = process.env.ANNOTASK_LIVE_CLI === '1'

export const LIVE_CLI_ONLY = (process.env.ANNOTASK_LIVE_ONLY ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s.length > 0)

export function isLiveCliEnabled(key: LiveProviderKey): boolean {
  if (LIVE_CLI_ONLY.length === 0) return true
  const short = key.replace(/-local$/, '')
  return LIVE_CLI_ONLY.includes(short) || LIVE_CLI_ONLY.includes(key)
}

export function liveModelFor(key: LiveProviderKey): string {
  const entry = MODEL_CONFIG[key]
  return (process.env[entry.env] ?? '').trim() || entry.default
}
