/**
 * Translate a normalized `PermissionMode` into each CLI's own permission flags,
 * plus a system-prompt prefix that enforces `plan` mode at the model level on
 * CLIs that don't have a native read-only flag.
 *
 * Why two surfaces (flags + prompt prefix):
 *   - claude-local has a real `--permission-mode plan` flag (CLI-enforced).
 *   - codex-local has `--sandbox read-only` (OS-enforced — writes fail at the
 *     sandbox boundary even if the model tries).
 *   - opencode-local headless `run` has only `--dangerously-skip-permissions`
 *     (no native plan equivalent).
 *   - copilot-local headless `-p` REQUIRES `--allow-all-tools` to run at all
 *     and has no native plan mode.
 *
 * To deliver plan mode uniformly across all four, we layer a strong
 * system-prompt directive when mode === 'plan'. The native flag still does the
 * heavy lifting on claude/codex (refusal can't be jailbroken); the prompt
 * directive is the only lever on opencode/copilot and is enforced at the
 * model layer (the model refuses write tools because the prompt told it to).
 *
 * Per-CLI flag surfaces observed at implementation time:
 *
 *   claude   --permission-mode <default|plan>
 *            --dangerously-skip-permissions               (bypass shorthand)
 *   codex    -s/--sandbox <read-only|workspace-write|danger-full-access>
 *            --full-auto                                  (workspace-write)
 *            --dangerously-bypass-approvals-and-sandbox
 *   opencode --dangerously-skip-permissions               (single boolean)
 *   copilot  --allow-all-tools                            (REQUIRED for `-p`)
 *            --no-ask-user
 *            --allow-all
 */

import type { PermissionMode } from '../schema.js'

/**
 * Claude Code CLI. 1:1 mapping — claude exposes plan/default/bypass natively.
 *
 * Bypass uses `--dangerously-skip-permissions` rather than the equivalent
 * `--permission-mode bypassPermissions` form because the dangerously-prefixed
 * flag is the one Claude surfaces in its own error messages (e.g. when it
 * refuses to run as root), matches the bypass-flag naming on codex / opencode,
 * and is what users will recognize when reading docs or stderr.
 */
export function claudePermissionFlags(mode: PermissionMode): string[] {
  switch (mode) {
    case 'default': return ['--permission-mode', 'default']
    case 'plan':    return ['--permission-mode', 'plan']
    case 'bypass':  return ['--dangerously-skip-permissions']
  }
}

/**
 * Codex CLI: sandbox-driven. `plan` clamps to `read-only` (OS-enforced);
 * `default` uses `--full-auto` (workspace-write, on-request approvals — but
 * approvals don't surface in non-interactive `exec`, so effectively
 * workspace-write); `bypass` removes the sandbox entirely.
 */
export function codexPermissionFlags(mode: PermissionMode): string[] {
  switch (mode) {
    case 'default': return ['--full-auto']
    case 'plan':    return ['--sandbox', 'read-only']
    case 'bypass':  return ['--dangerously-bypass-approvals-and-sandbox']
  }
}

/**
 * Opencode CLI: only `--dangerously-skip-permissions` is exposed in headless
 * `run`. Default and plan both omit it; plan additionally relies on the
 * system-prompt directive from `permissionModeSystemPromptPrefix` to enforce
 * read-only at the model layer.
 */
export function opencodePermissionFlags(mode: PermissionMode): string[] {
  if (mode === 'bypass') return ['--dangerously-skip-permissions']
  return []
}

/**
 * Copilot CLI: headless `-p` mode requires `--allow-all-tools` to run at all,
 * so even `plan` keeps it. The model-layer plan directive does the actual
 * read-only enforcement on this CLI. `bypass` additionally enables
 * `--allow-all` (paths + URLs + tools).
 */
export function copilotPermissionFlags(mode: PermissionMode): string[] {
  switch (mode) {
    case 'bypass':  return ['--allow-all', '--allow-all-tools', '--no-ask-user']
    case 'default':
    case 'plan':    return ['--allow-all-tools', '--no-ask-user']
  }
}

/**
 * Local-CLI bin names recognized by the init pipeline. Kept in this file
 * (rather than init.ts) so `initPermissionModeFor` and the AgentQuickSetup
 * warning copy can share the same surface.
 */
export type InitCliBin = 'claude' | 'codex' | 'opencode' | 'copilot'

/**
 * CLIs that have NO headless "ask / workspace-write" mode — for them `default`
 * cannot run autonomously (the call either blocks on a permission prompt with
 * no human to answer, or refuses tools outright), so `default` has to escalate
 * to `bypass` to do anything at all.
 *
 *   claude   — headless `default` blocks Bash/grep tool calls; no native
 *              workspace-write mode exists.
 *   opencode — headless `run` exposes only `--dangerously-skip-permissions`;
 *              `default` emits no flag and stalls on the first write prompt.
 *
 * codex (`--full-auto`, an OS-enforced workspace-write sandbox) and copilot
 * (`--allow-all-tools --no-ask-user`, the minimum `-p` requires) DO honor
 * `default` headlessly, and those modes are strictly safer than `bypass`, so
 * they are left untouched.
 */
const NO_HEADLESS_DEFAULT: ReadonlySet<InitCliBin> = new Set(['claude', 'opencode'])

/**
 * Map a *requested* permission mode to the mode that actually runs headlessly
 * on the given CLI. The only adjustment is `default` → `bypass` on the CLIs in
 * `NO_HEADLESS_DEFAULT`; every other (cli, mode) pair passes through unchanged.
 *
 * This is what makes `'default'` a safe, working out-of-box default: codex and
 * copilot keep their sandboxed/minimal modes, while claude and opencode — which
 * have no headless ask-mode — fall back to the only thing that works for them.
 * Plan and bypass are never rewritten (plan is read-only everywhere; bypass is
 * already maximal).
 */
export function normalizeHeadlessMode(mode: PermissionMode, bin: InitCliBin): PermissionMode {
  if (mode === 'default' && NO_HEADLESS_DEFAULT.has(bin)) return 'bypass'
  return mode
}

/**
 * The out-of-box default permission mode for a given CLI: the least-permissive
 * mode that still lets the agent apply tasks headlessly. Equivalent to
 * `normalizeHeadlessMode('default', bin)` — codex/copilot → `default`
 * (sandboxed/minimal), claude/opencode → `bypass` (no headless ask-mode).
 *
 * Used as the fail-safe fallback in each provider's `buildSpawn` so a missing
 * resolved mode lands on the CLI's safe default rather than blanket `bypass`.
 */
export function defaultPermissionModeFor(bin: InitCliBin): PermissionMode {
  return normalizeHeadlessMode('default', bin)
}

/**
 * Least-permissive `PermissionMode` that still lets the headless init agent
 * write into `.annotask/` for each CLI. Init runs `--print` / `exec` / `run`
 * / `-p` with stdin closed, so it can never answer an interactive permission
 * prompt — the choice is "permissive enough to write, or the run hangs/refuses."
 * Identical to `defaultPermissionModeFor`: init wants the same safe-but-working
 * mode the per-task runner now defaults to.
 */
export function initPermissionModeFor(bin: InitCliBin): PermissionMode {
  return defaultPermissionModeFor(bin)
}

/** Resolved init-mode flags per CLI — what spawnCliWithSkill actually passes. */
export function initPermissionFlagsFor(bin: InitCliBin): string[] {
  const mode = initPermissionModeFor(bin)
  switch (bin) {
    case 'claude':   return claudePermissionFlags(mode)
    case 'codex':    return codexPermissionFlags(mode)
    case 'opencode': return opencodePermissionFlags(mode)
    case 'copilot':  return copilotPermissionFlags(mode)
  }
}

/**
 * Optional system-prompt directive prepended to the persona/skill system
 * prompt. Plan mode is the only one that needs this — claude and codex enforce
 * read-only at the CLI/OS layer regardless, and the directive reinforces them;
 * opencode and copilot have no native plan mode, so the directive is the only
 * line of defense and must be strong enough to make the model refuse on its
 * own.
 *
 * Returns an empty string for `default` and `bypass` so the system prompt
 * stays unchanged in the common case.
 */
export function permissionModeSystemPromptPrefix(mode: PermissionMode): string {
  if (mode !== 'plan') return ''
  return [
    '## PLAN MODE — READ-ONLY',
    '',
    'You are running in plan mode for this turn. Do NOT call any tool that',
    'writes, edits, deletes, or executes commands. Allowed: reading files,',
    'searching code, inspecting state, viewing structure. Forbidden: file',
    'edits, shell commands, network mutations, package installs, git writes,',
    'or any side effect that changes the project or system.',
    '',
    'Your job is to produce a written plan describing what you WOULD do, with',
    'concrete file paths, line ranges, and code snippets. Do not apply any',
    'changes — even partial ones.',
    '',
    "If the user's request requires a write to satisfy, say so explicitly and",
    'stop. The user will re-run the task in a different permission mode if',
    'they want the change applied.',
  ].join('\n')
}
