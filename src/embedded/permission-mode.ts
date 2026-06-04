/**
 * Permission-mode helpers shared between the shell UI and the provider stream
 * options. The canonical type + enum live in `src/schema.ts` (alongside
 * TASK_TYPES) since they cross the wire to the server and to MCP boundaries.
 *
 * Three tiers:
 *   - global   — `ProviderSettings.permissionMode`, set in the General tab.
 *                Floor for all providers and the default for new ones.
 *   - provider — `ProviderConfig.permissionMode` on each local-CLI provider.
 *                Optional per-provider override (set in Provider settings).
 *   - task     — `AnnotaskTask.permissionMode`, flipped via the chip menu in
 *                the Conversation tab or the dropdown in Task details.
 *
 * Resolution: `task ?? provider ?? global ?? 'bypass'`. Global always has a
 * value (the schema defaults it to `'bypass'` for back-compat with installs
 * predating the feature).
 */

import { z } from 'zod'
import { PERMISSION_MODES, type PermissionMode } from '../schema.js'

export { PERMISSION_MODES, type PermissionMode } from '../schema.js'

export const PermissionModeSchema = z.enum(PERMISSION_MODES)

/**
 * Resolve the effective permission mode for an agent run. First defined tier
 * wins (task > provider > global). `'bypass'` is the historical fallback so
 * installs that haven't opted in still run with their old flags.
 */
export function resolveEffectivePermissionMode(
  taskMode: PermissionMode | undefined | null,
  providerMode: PermissionMode | undefined | null,
  globalMode: PermissionMode | undefined | null,
): PermissionMode {
  if (taskMode) return taskMode
  if (providerMode) return providerMode
  if (globalMode) return globalMode
  return 'bypass'
}

/**
 * Providers whose `plan` (read-only) mode is enforced at the CLI/OS boundary —
 * claude (`--permission-mode plan`) and codex (`--sandbox read-only`). opencode
 * and copilot are deliberately absent: their headless modes have no native
 * read-only flag, so plan there is best-effort (model-directive only, via
 * `permissionModeSystemPromptPrefix`). Single source of truth for the UI hints
 * that distinguish hard vs. soft plan enforcement.
 */
export const NATIVE_PLAN_PROVIDERS: ReadonlySet<string> = new Set(['claude-local', 'codex-local'])

/** Human labels for the picker UI. */
export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  default: 'Default — CLI asks for non-trivial actions',
  plan: 'Plan — read-only, no writes',
  bypass: 'Bypass — auto-approve everything',
}

/** Short labels for compact dropdowns. */
export const PERMISSION_MODE_SHORT_LABELS: Record<PermissionMode, string> = {
  default: 'Default',
  plan: 'Plan',
  bypass: 'Bypass',
}
