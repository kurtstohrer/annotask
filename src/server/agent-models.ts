/**
 * Model discovery for the embedded agent UI.
 *
 * Each local CLI exposes its installed models differently:
 *   - opencode:    `opencode models` prints `provider/model` lines, one per
 *                  entry. Captures everything including multi-segment paths
 *                  like `vllm/Qwen/Qwen2.5-7B-Instruct-AWQ`.
 *   - codex:       No `models` subcommand. Reads ~/.codex/models_cache.json
 *                  which the Codex CLI maintains automatically (slug +
 *                  display_name).
 *   - claude:      No headless listing. The user sets a model id directly
 *                  in provider config or uses Auto (CLI default).
 *
 * Discovery runs on demand from `GET /__annotask/api/agent/models?cli=NAME`,
 * caches per CLI for 5 minutes, and always prepends an "Auto" entry.
 * Probes are best-effort with a 5s timeout. When a probe fails or a
 * provider has no probe at all, the catalog comes back with only "Auto" +
 * an `error` string explaining the gap — there are no curated fallbacks.
 * The UI uses `error` to block selection of a specific model id rather
 * than silently serving guesses that the underlying CLI would later reject.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const execFileAsync = promisify(execFile)

/**
 * ANSI escape sequence stripper. opencode / gh copilot output sometimes
 * arrives with terminal control sequences when stdout is a TTY proxy
 * (e.g. running through a wrapper that doesn't honor `--no-color`).
 * Stripping them is the difference between "Auto only" and a full list.
 */
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

export type ProvideredId = 'claude-local' | 'codex-local' | 'opencode-local' | 'copilot-local' | 'anthropic' | 'openai' | 'openrouter' | 'openai-compatible' | 'paperclip'

export interface ModelOption {
  id: string
  label: string
  /**
   * `auto` — synthetic "Auto (CLI default)" entry, present in every catalog.
   * `discovered` — returned by a live probe against the provider's own
   *   catalog (`opencode models`, the Codex model cache file). Trust
   *   completely — these are the user's real options.
   * `static` — provider has no headless model-list API, so we serve a
   *   canonical short list of ids the CLI/HTTP endpoint is known to
   *   accept (Claude's `opus`/`sonnet`/`haiku` aliases, Anthropic's
   *   public model ids). NOT a "fallback" — this IS the catalog for
   *   that provider; there's no probe to fall back from.
   */
  source: 'auto' | 'discovered' | 'static'
}

export interface AgentModelCatalog {
  cli: ProvideredId
  models: ModelOption[]
  discovered: boolean
  cachedAt: number
  /**
   * When non-empty, the live model list could not be obtained — either the
   * provider has no probe implemented, or the probe ran and returned
   * nothing. Consumers should block selection of a specific model and
   * surface this to the user instead of pretending a curated list is the
   * truth. `Auto (CLI default)` is still safe to use because the provider
   * itself picks the model.
   */
  error?: string
}

const AUTO_OPTION: ModelOption = { id: '', label: 'Auto (CLI default)', source: 'auto' }

/**
 * Static catalogs for providers that have no headless model-list API.
 *
 * These are NOT fallbacks for failed probes — they're the authoritative
 * catalog for providers that simply don't expose discovery. The Claude CLI
 * resolves `opus`/`sonnet`/`haiku` to the current production model ids;
 * Anthropic/OpenAI/OpenRouter publish stable model ids that the
 * chat-completions endpoint accepts directly.
 *
 * Probed providers (codex-local, opencode-local, copilot-local) are
 * intentionally absent from this map. If their probe returns nothing, we
 * surface an error so the UI can block — guessing at their catalogs is what
 * caused the original "gpt-5.4-mini may not exist" failure.
 */
const STATIC_CATALOGS: Partial<Record<ProvideredId, ModelOption[]>> = {
  'claude-local': [
    // CLI aliases — Claude Code resolves these to the current release.
    { id: 'opus',   label: 'Opus 4.7',  source: 'static' },
    { id: 'sonnet', label: 'Sonnet 4.6', source: 'static' },
    { id: 'haiku',  label: 'Haiku 4.5', source: 'static' },
  ],
  anthropic: [
    { id: 'claude-opus-4-7',          label: 'Opus 4.7',  source: 'static' },
    { id: 'claude-sonnet-4-6',        label: 'Sonnet 4.6', source: 'static' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', source: 'static' },
  ],
  openai: [
    { id: 'gpt-5',      label: 'GPT-5',      source: 'static' },
    { id: 'gpt-5-mini', label: 'GPT-5 mini', source: 'static' },
    { id: 'gpt-4o',     label: 'GPT-4o',     source: 'static' },
    { id: 'o3',         label: 'o3',         source: 'static' },
  ],
  openrouter: [
    { id: 'anthropic/claude-sonnet-4-6', label: 'Sonnet 4.6 (Anthropic)', source: 'static' },
    { id: 'openai/gpt-5',                 label: 'GPT-5 (OpenAI)',         source: 'static' },
    { id: 'openai/gpt-4o-mini',           label: 'GPT-4o mini (OpenAI)',   source: 'static' },
  ],
  'openai-compatible': [
    // Common ids people self-host. The user usually sets the model field
    // to whatever their endpoint actually serves — these are suggestions.
    { id: 'qwen2.5-coder', label: 'qwen2.5-coder', source: 'static' },
    { id: 'llama3.1',      label: 'llama3.1',       source: 'static' },
  ],
  paperclip: [
    { id: 'paperclip-default', label: 'Paperclip default', source: 'static' },
  ],
}

const CACHE_TTL_MS = 5 * 60_000   // 5 min — model lists don't change often
const PROBE_TIMEOUT_MS = 5_000
const cache = new Map<string, AgentModelCatalog>()

export interface ListAgentModelsOptions {
  /** Skip the in-process cache and force a fresh probe. */
  refresh?: boolean
}

export async function listAgentModels(cli: ProvideredId, opts: ListAgentModelsOptions = {}): Promise<AgentModelCatalog> {
  const hit = cache.get(cli)
  if (!opts.refresh && hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) return hit

  const discovered = await tryDiscover(cli)

  // Live probe found real options — trust it as the authoritative list.
  if (discovered.length > 0) {
    return cacheAndReturn(cli, {
      cli,
      models: [AUTO_OPTION, ...discovered],
      discovered: true,
      cachedAt: Date.now(),
    })
  }

  // No probe data. Two cases:
  //   1. Provider has a static catalog (claude-local, anthropic, openai, …)
  //      — that IS the catalog. No error; the UI shows the static list.
  //   2. Provider was expected to probe but didn't return anything
  //      (copilot, codex-local, opencode-local, copilot-local) — surface a
  //      targeted error so the picker is blocked rather than guessing.
  const staticList = STATIC_CATALOGS[cli]
  if (staticList) {
    return cacheAndReturn(cli, {
      cli,
      models: [AUTO_OPTION, ...staticList],
      discovered: false,
      cachedAt: Date.now(),
    })
  }

  let error: string
  if (cli === 'copilot-local') {
    error = await copilotLocalNoListError()
  } else {
    error = `${cli}: no models returned by the live probe. Sign in to the provider's CLI / account, check network access, then refresh.`
  }

  return cacheAndReturn(cli, {
    cli,
    models: [AUTO_OPTION],
    discovered: false,
    cachedAt: Date.now(),
    error,
  })
}

function cacheAndReturn(cli: ProvideredId, catalog: AgentModelCatalog): AgentModelCatalog {
  cache.set(cli, catalog)
  return catalog
}

async function copilotLocalNoListError(): Promise<string> {
  const def = await readCopilotCliDefaultModel()
  const tail = def
    ? ` Your CLI default is "${def}" — pick Auto to use it, or set a custom id matching one your account supports.`
    : ' Use Auto (CLI default), or set a custom id matching one your account supports.'
  return `The Copilot CLI doesn't expose a model list. Run \`copilot\` interactively and \`/model\` to see your options.${tail}`
}

export function invalidateAgentModels(cli?: ProvideredId): void {
  if (cli) cache.delete(cli)
  else cache.clear()
}

async function tryDiscover(cli: ProvideredId): Promise<ModelOption[]> {
  switch (cli) {
    case 'opencode-local': return probeOpenCode()
    case 'codex-local': return probeCodex()
    case 'copilot-local':
      // CLI subprocess: the `copilot` binary's `--model` flag does NOT accept
      // the HTTP catalog's ids (e.g. settings.json defaults to
      // `claude-sonnet-4.5`, not the HTTP API's `claude-sonnet-4.6`). The
      // CLI has no headless model-list command, so we deliberately return
      // nothing and let listAgentModels() surface a copilot-local-specific
      // error. See the message in listAgentModels() for the user guidance.
      return []
    default: return []
  }
}

// ── opencode ──────────────────────────────────────────

async function probeOpenCode(): Promise<ModelOption[]> {
  // Retry once on transient failure — opencode occasionally exits non-zero
  // on the first invocation after a fresh install while it lays down its
  // config dir. The second call almost always succeeds.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Hint NO_COLOR so newer opencode builds don't smuggle ANSI in; we
      // still strip defensively in case the env hint is ignored.
      const { stdout } = await execFileAsync('opencode', ['models'], {
        timeout: PROBE_TIMEOUT_MS,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
        maxBuffer: 8 * 1024 * 1024,
      })
      const parsed = parseOpenCodeModels(stdout)
      if (parsed.length > 0) return parsed
    } catch {
      // fall through to retry / fallback
    }
  }
  return []
}

/**
 * Parse `opencode models` output.
 *
 * The command prints one entry per line in `provider/model` format.
 * Models with nested paths (`vllm/Qwen/Qwen2.5-7B-Instruct-AWQ`) are
 * captured as the full trimmed line — the previous regex stopped at the
 * first two path segments and silently discarded the rest.
 *
 * Also accepts JSON (object with `models` array or bare array) in case
 * a future opencode version adds `--format=json`.
 */
export function parseOpenCodeModels(stdout: string): ModelOption[] {
  // Defensive: opencode sometimes ignores NO_COLOR and emits ANSI control
  // sequences. Strip them before any parsing so the `provider/model` check
  // below sees clean lines.
  const trimmed = stripAnsi(stdout).trim()
  if (!trimmed) return []

  // JSON first
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed.map(asModelOption).filter((m): m is ModelOption => m != null)
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).models)) {
      const list = (parsed as { models: unknown[] }).models
      return list.map(asModelOption).filter((m: ModelOption | null): m is ModelOption => m != null)
    }
  } catch {
    // not JSON — line parser below
  }

  // Line-based: one `provider/model[/path...]` per line. Recent opencode
  // releases sometimes wrap the id with table decorations or status glyphs
  // (e.g. `→ anthropic/claude-sonnet-4-5  (active)`). Pick the first
  // whitespace-separated token that has a slash so multi-segment ids like
  // `vllm/Qwen/Model-7B` survive intact while the decorations are dropped.
  const out: ModelOption[] = []
  const seen = new Set<string>()
  for (const raw of trimmed.split(/\r?\n/)) {
    // Strip common leading decoration characters opencode prepends to the
    // active row (>, *, →, •, ✓ …) so the slash-detector sees the bare id.
    const line = raw.replace(/^[\s>*→•✓✔•→-]+/, '').trim()
    if (!line || line.startsWith('#') || line.startsWith('=')) continue
    // Take the first slashed token (a provider/model id never contains
    // whitespace). Anything after it (parens, version hints, "active") is
    // discarded.
    const token = line.split(/\s+/).find((t) => t.includes('/'))
    if (!token) continue
    // Sanity: a model id won't realistically be longer than 200 chars.
    if (token.length > 200) continue
    if (seen.has(token)) continue
    seen.add(token)
    out.push({ id: token, label: token, source: 'discovered' })
  }
  return out
}

// ── codex ─────────────────────────────────────────────

/**
 * Codex doesn't expose a headless `models` subcommand. The CLI maintains
 * a local model catalog at `~/.codex/models_cache.json` — read that
 * file directly so users always see what Codex actually knows about.
 */
async function probeCodex(): Promise<ModelOption[]> {
  const cachePath = path.join(os.homedir(), '.codex', 'models_cache.json')
  try {
    const raw = await fsp.readFile(cachePath, 'utf-8')
    return parseCodexModelsCache(raw)
  } catch {
    return []
  }
}

export function parseCodexModelsCache(raw: string): ModelOption[] {
  try {
    const json = JSON.parse(raw)
    const models: unknown[] = Array.isArray(json?.models) ? json.models : []
    const out: ModelOption[] = []
    const seen = new Set<string>()
    for (const m of models) {
      if (!m || typeof m !== 'object') continue
      const o = m as Record<string, unknown>
      const id = typeof o.slug === 'string' ? o.slug : null
      if (!id || seen.has(id)) continue
      seen.add(id)
      const label = typeof o.display_name === 'string' ? o.display_name : id
      out.push({ id, label, source: 'discovered' })
    }
    return out
  } catch {
    return []
  }
}

// ── copilot-local (CLI subprocess) ────────────────────

/**
 * Best-effort read of the Copilot CLI's saved default model. Lives in
 * `~/.copilot/settings.json` and is the *only* model the CLI guarantees
 * will work for the current user without an interactive `/model` switch.
 * Used purely to surface a helpful hint in the error message — never to
 * populate the model dropdown (we don't have a way to enumerate the rest).
 */
async function readCopilotCliDefaultModel(): Promise<string | null> {
  try {
    const raw = await fsp.readFile(path.join(os.homedir(), '.copilot', 'settings.json'), 'utf-8')
    const json = JSON.parse(raw) as { model?: unknown }
    return typeof json.model === 'string' && json.model.length > 0 ? json.model : null
  } catch {
    return null
  }
}

// ── helpers ───────────────────────────────────────────

function asModelOption(raw: unknown): ModelOption | null {
  if (typeof raw === 'string') return { id: raw, label: raw, source: 'discovered' }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : typeof o.name === 'string' ? o.name : null
    if (!id) return null
    const label = typeof o.label === 'string' ? o.label
      : typeof o.displayName === 'string' ? o.displayName
      : id
    return { id, label, source: 'discovered' }
  }
  return null
}

