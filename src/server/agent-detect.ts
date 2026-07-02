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
 * Docker / sandboxed envs: when Annotask runs inside a container, host-side
 * CLI binaries and auth files aren't visible by default. Two env vars let the
 * probe scan host-mounted paths instead of (or in addition to) the container's
 * own PATH and $HOME:
 *   - ANNOTASK_HOST_PATH — colon-separated dirs appended to PATH for `whichBin`
 *   - ANNOTASK_HOST_HOME — alt home dir checked alongside `os.homedir()` for
 *     auth files (e.g. mount `/host-home` and set this to it)
 * The version probe still spawns the discovered binary; if the host path isn't
 * actually executable from inside the container, the spawn just times out and
 * `version` comes back undefined — `found` and `loggedIn` remain accurate.
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
  /**
   * True when the installed CLI's help text advertises session resume
   * (`claude --resume`, `codex exec resume`, `opencode run --session`,
   * `copilot --resume`). `undefined` = probe failed/timed out (treat as
   * unsupported). The embedded runner only attempts resume on `true`; a
   * false negative just means the replay path keeps being used.
   */
  resume?: boolean
  /** claude only: `--append-system-prompt` available — the composed skill
   *  prompt can ride the system segment instead of the user message. */
  appendSystemPrompt?: boolean
  /** codex only: `codex exec -` reads the prompt from stdin — dodges the
   *  argv size cap and keeps prompts out of `ps` output. */
  stdinPrompt?: boolean
}

/** Capability keys a help-text probe can set on CliStatus. */
type HelpCapKey = 'resume' | 'appendSystemPrompt' | 'stdinPrompt'

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
const HELP_TIMEOUT_MS = 2_500
const HELP_MAX_BYTES = 65_536

interface DetectorConfig {
  bin: string
  /** Files relative to $HOME whose existence implies "logged in." */
  authFiles: string[]
  /** Args to pass to the CLI to get a version. Some CLIs use `--version`, some `version`. */
  versionArgs?: string[]
  /** Help invocations to grep for capability flags. Each entry is ONE spawn;
   *  all its `caps` patterns are evaluated against the same help text. Flags
   *  are version-dependent, so this is the cheapest offline feature detection
   *  that can't false-positive on an old install. Omit = never probe (the
   *  capability stays undefined = treated as unsupported). */
  helpProbes?: Array<{ args: string[]; caps: Partial<Record<HelpCapKey, RegExp>> }>
}

/** Pure predicate for a help-text capability probe — exported for tests. */
export function helpIndicatesCapability(helpText: string | undefined, pattern: RegExp): boolean | undefined {
  if (typeof helpText !== 'string' || helpText.length === 0) return undefined
  return pattern.test(helpText)
}

const DETECTORS: Record<'claude-local' | 'codex-local' | 'opencode-local' | 'copilot-local' | 'copilot', DetectorConfig> = {
  'claude-local': {
    bin: 'claude',
    // `claude login` writes `.claude/auth.json` (or `.credentials.json` on older
    // versions). Either implies logged in. The directory alone is not enough
    // because Claude Code creates `.claude/` for project scaffolding too.
    authFiles: ['.claude/auth.json', '.claude/.credentials.json'],
    versionArgs: ['--version'],
    helpProbes: [{
      args: ['--help'],
      caps: { resume: /--resume\b/, appendSystemPrompt: /--append-system-prompt\b/ },
    }],
  },
  'codex-local': {
    bin: 'codex',
    authFiles: ['.codex/auth.json', '.codex/auth.toml'],
    versionArgs: ['--version'],
    // `codex exec --help` lists the `resume` subcommand when supported, and
    // documents `-` / stdin prompt reading on the PROMPT argument.
    helpProbes: [{
      args: ['exec', '--help'],
      caps: { resume: /\bresume\b/, stdinPrompt: /read from stdin/i },
    }],
  },
  'opencode-local': {
    bin: 'opencode',
    authFiles: ['.local/share/opencode/auth.json', '.config/opencode/auth.json'],
    versionArgs: ['--version'],
    // `opencode run --help` lists `-s, --session` when session continuation
    // is supported.
    helpProbes: [{ args: ['run', '--help'], caps: { resume: /--session\b/ } }],
  },
  'copilot-local': {
    bin: 'copilot',
    // GitHub Copilot CLI writes `config.json` on first launch (set up at
    // `firstLaunchAt`). Treat its existence as "logged in" — the CLI itself
    // surfaces a clearer auth error if the session has expired.
    authFiles: ['.copilot/config.json'],
    versionArgs: ['--version'],
    helpProbes: [{ args: ['--help'], caps: { resume: /--resume\b/ } }],
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

/** Exposed for tests (probe patterns are config, not behavior). */
export const __test = { DETECTORS }

export function createAgentDetector(): AgentDetector {
  let cache: { ts: number; snapshot: AgentDetectSnapshot } | null = null

  async function probe(cfg: DetectorConfig): Promise<CliStatus> {
    const binPath = await whichBin(cfg.bin)
    if (!binPath) return { found: false }
    const homeDirs = [os.homedir()]
    const hostHome = process.env.ANNOTASK_HOST_HOME
    if (hostHome && hostHome !== os.homedir()) homeDirs.push(hostHome)
    const authPaths = cfg.authFiles.flatMap((rel) => homeDirs.map((h) => path.join(h, rel)))
    const [version, loggedIn, ...helpTexts] = await Promise.all([
      cfg.versionArgs ? readVersion(binPath, cfg.versionArgs) : Promise.resolve(undefined),
      anyExists(authPaths),
      ...(cfg.helpProbes ?? []).map((p) => readHelp(binPath, p.args)),
    ])
    const status: CliStatus = { found: true, binPath, version, loggedIn }
    for (let i = 0; i < (cfg.helpProbes?.length ?? 0); i++) {
      const probe = cfg.helpProbes![i]
      for (const [cap, pattern] of Object.entries(probe.caps) as Array<[HelpCapKey, RegExp]>) {
        const verdict = helpIndicatesCapability(helpTexts[i] as string | undefined, pattern)
        if (verdict !== undefined) status[cap] = verdict
      }
    }
    return status
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
  const sep = process.platform === 'win32' ? ';' : ':'
  const exts = process.platform === 'win32' ? (process.env.PATHEXT?.split(';') ?? ['.EXE', '.CMD', '.BAT']) : ['']
  // Append host-mounted dirs for dockerized installs (see file header).
  const hostPath = process.env.ANNOTASK_HOST_PATH ?? ''
  const PATH = hostPath ? `${process.env.PATH ?? ''}${sep}${hostPath}` : (process.env.PATH ?? '')
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

/**
 * Read a CLI's help text (stdout+stderr merged — clap prints help to stdout,
 * some CLIs use stderr for subcommand help). Larger cap and a longer timeout
 * than the version probe: help output is a few KB and some CLIs cold-start
 * slowly. Undefined on timeout/error — the caller treats that as "unknown".
 */
function readHelp(binPath: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out = ''
    const child = spawn(binPath, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const t = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      resolve(undefined)
    }, HELP_TIMEOUT_MS)
    const take = (chunk: string) => {
      if (out.length < HELP_MAX_BYTES) out += chunk.slice(0, HELP_MAX_BYTES - out.length)
    }
    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', take)
    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', take)
    child.on('error', () => { clearTimeout(t); resolve(undefined) })
    child.on('close', () => {
      clearTimeout(t)
      resolve(out.length > 0 ? out : undefined)
    })
  })
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
