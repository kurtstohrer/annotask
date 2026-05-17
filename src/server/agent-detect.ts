/**
 * Local-CLI detection probe.
 *
 * `GET /__annotask/api/agent/detect` returns a snapshot of which agent CLIs
 * are installed on the user's PATH and whether they appear logged in.
 *
 * "Logged in" is best-effort — we check for the existence of the auth file
 * each CLI maintains, not its validity. False positives are tolerable (the
 * provider will surface a real error when the user actually runs); false
 * negatives are the failure mode we work hard to avoid (claude-local
 * provider only enables when this probe says yes).
 *
 * Cached for 30 seconds so the settings panel doesn't fork a dozen
 * subprocesses every render.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

export interface CliStatus {
  /** Binary found on PATH. */
  found: boolean
  /** Absolute path to the binary, when found. */
  binPath?: string
  /** Version string from `<cli> --version`, when probeable within the timeout. */
  version?: string
  /** Best-effort "is the user logged in" probe. */
  loggedIn?: boolean
}

export interface AgentDetectSnapshot {
  'claude-local': CliStatus
  'codex-local': CliStatus
  'opencode-local': CliStatus
  'copilot-local': CliStatus
  copilot: CliStatus
  openrouter: { hasEnv: boolean }
  /** When this snapshot was taken (ms since epoch). Clients display "checked X ago." */
  ts: number
}

const CACHE_TTL_MS = 30_000
const VERSION_TIMEOUT_MS = 1_000

interface DetectorConfig {
  bin: string
  /** Files relative to $HOME whose existence implies "logged in." */
  authFiles: string[]
  /** Args to pass to the CLI to get a version. Some CLIs use `--version`, some `version`. */
  versionArgs?: string[]
}

const DETECTORS: Record<'claude-local' | 'codex-local' | 'opencode-local' | 'copilot-local' | 'copilot', DetectorConfig> = {
  'claude-local': {
    bin: 'claude',
    // `claude login` writes `.claude/auth.json` (or `.credentials.json` on older
    // versions). Either implies logged in. The directory alone is not enough
    // because Claude Code creates `.claude/` for project scaffolding too.
    authFiles: ['.claude/auth.json', '.claude/.credentials.json'],
    versionArgs: ['--version'],
  },
  'codex-local': {
    bin: 'codex',
    authFiles: ['.codex/auth.json', '.codex/auth.toml'],
    versionArgs: ['--version'],
  },
  'opencode-local': {
    bin: 'opencode',
    authFiles: ['.local/share/opencode/auth.json', '.config/opencode/auth.json'],
    versionArgs: ['--version'],
  },
  'copilot-local': {
    bin: 'copilot',
    // GitHub Copilot CLI writes `config.json` on first launch (set up at
    // `firstLaunchAt`). Treat its existence as "logged in" — the CLI itself
    // surfaces a clearer auth error if the session has expired.
    authFiles: ['.copilot/config.json'],
    versionArgs: ['--version'],
  },
  copilot: {
    bin: 'gh',
    // Copilot Chat accepts any GitHub OAuth token tied to an account with a
    // Copilot subscription. The token can live in either of two places:
    //   • `~/.config/github-copilot/{apps,hosts}.json` — written by the
    //     GitHub Copilot IDE extension and the newer `copilot` CLI auth
    //     flow.
    //   • `~/.config/gh/hosts.yml` — written by `gh auth login`. The token
    //     read path in copilot-provider falls back to this via `gh auth
    //     token` when the IDE-extension files are absent.
    // Either file's existence implies "user has a usable token somewhere".
    authFiles: [
      '.config/github-copilot/hosts.json',
      '.config/github-copilot/apps.json',
      '.config/gh/hosts.yml',
    ],
    versionArgs: ['--version'],
  },
}

export interface AgentDetector {
  detect(): Promise<AgentDetectSnapshot>
  /** Force a re-probe on the next detect() call. */
  invalidate(): void
}

export function createAgentDetector(): AgentDetector {
  let cache: { ts: number; snapshot: AgentDetectSnapshot } | null = null

  async function probe(cfg: DetectorConfig): Promise<CliStatus> {
    const binPath = await whichBin(cfg.bin)
    if (!binPath) return { found: false }
    const [version, loggedIn] = await Promise.all([
      cfg.versionArgs ? readVersion(binPath, cfg.versionArgs) : Promise.resolve(undefined),
      anyExists(cfg.authFiles.map((rel) => path.join(os.homedir(), rel))),
    ])
    return { found: true, binPath, version, loggedIn }
  }

  async function detect(): Promise<AgentDetectSnapshot> {
    if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.snapshot
    const [claude, codex, opencode, copilotLocal, copilot] = await Promise.all([
      probe(DETECTORS['claude-local']),
      probe(DETECTORS['codex-local']),
      probe(DETECTORS['opencode-local']),
      probe(DETECTORS['copilot-local']),
      probe(DETECTORS.copilot),
    ])
    const snapshot: AgentDetectSnapshot = {
      'claude-local': claude,
      'codex-local': codex,
      'opencode-local': opencode,
      'copilot-local': copilotLocal,
      copilot,
      openrouter: { hasEnv: typeof process.env.OPENROUTER_API_KEY === 'string' && process.env.OPENROUTER_API_KEY.length > 0 },
      ts: Date.now(),
    }
    cache = { ts: snapshot.ts, snapshot }
    return snapshot
  }

  function invalidate(): void { cache = null }

  return { detect, invalidate }
}

async function whichBin(name: string): Promise<string | undefined> {
  // Path separator differs on Windows; we don't claim Windows support but
  // detection should at least not throw there.
  const PATH = process.env.PATH ?? ''
  const sep = process.platform === 'win32' ? ';' : ':'
  const exts = process.platform === 'win32' ? (process.env.PATHEXT?.split(';') ?? ['.EXE', '.CMD', '.BAT']) : ['']
  for (const dir of PATH.split(sep)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext)
      try {
        const st = await fsp.stat(candidate)
        if (st.isFile()) return candidate
      } catch { /* not here */ }
    }
  }
  return undefined
}

async function anyExists(paths: string[]): Promise<boolean> {
  for (const p of paths) {
    try {
      await fsp.access(p)
      return true
    } catch { /* keep checking */ }
  }
  return false
}

function readVersion(binPath: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    let stdout = ''
    const child = spawn(binPath, args, { shell: false, stdio: ['ignore', 'pipe', 'ignore'] })
    const t = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      resolve(undefined)
    }, VERSION_TIMEOUT_MS)
    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      // Cap input — version strings are tiny; if more arrives, something's off.
      if (stdout.length > 256) { try { child.kill('SIGKILL') } catch { /* ignore */ } }
    })
    child.on('error', () => { clearTimeout(t); resolve(undefined) })
    child.on('close', () => {
      clearTimeout(t)
      const trimmed = stdout.trim()
      resolve(trimmed.length > 0 ? trimmed.split('\n')[0] : undefined)
    })
  })
}
