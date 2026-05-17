/**
 * Agent personas — named bundles of provider + model + effort + target task
 * types. Each task picks a persona (or falls back to the global active
 * provider) and the embedded runner resolves the persona's settings before
 * spawning the provider. The system prompt is composed from the
 * `annotask-apply` skill + the task-type companion playbook via the shared
 * skills loader (see src/skills/loader.ts).
 *
 * Personas are additive: tasks without a `personaOverride` mapping keep
 * today's "global activeProvider" behavior. Built-ins are read-only;
 * customs (`custom:<uuid>`) are user-cloned and editable.
 */

import { z } from 'zod'
// Type-only imports so we keep the strong static type without creating a
// runtime cycle with provider-config.ts (which imports
// `PersonaConfigSchema` from here at module load).
import type { ProviderId, EffortLevel } from './provider-config.js'
import { TASK_TYPES, type TaskType } from '../schema.js'

const TaskTypeSchema = z.enum(TASK_TYPES)

// Runtime enums duplicated here so PersonaConfigSchema doesn't have to pull
// the schemas from provider-config. The corresponding TypeScript types
// `ProviderId` / `EffortLevel` remain the single source of truth via the
// type-only import above.
const PROVIDER_ID_VALUES = [
  'claude-local',
  'codex-local',
  'opencode-local',
  'copilot-local',
  'anthropic',
  'openai',
  'openrouter',
  'openai-compatible',
  'paperclip',
] as const satisfies readonly ProviderId[]

const EFFORT_VALUES = ['auto', 'minimal', 'low', 'medium', 'high'] as const satisfies readonly EffortLevel[]

export const PersonaConfigSchema = z.object({
  /** Stable id. Built-ins use a bare slug (`general`, `designer`, …); user
   *  customs are prefixed `custom:` so the UI can flag them as editable. */
  id: z.string().min(1),
  /** Display name shown in the persona row + task picker. */
  name: z.string().min(1),
  /** Short one-line description of when the persona fires. */
  description: z.string().default(''),
  /** Task types this persona targets. Empty means "fallback for everything
   *  not claimed by another persona." */
  taskTypes: z.array(TaskTypeSchema).default([]),
  /** Which provider this persona uses when it fires. */
  providerId: z.enum(PROVIDER_ID_VALUES),
  /** Override model id — empty means use the provider's default. */
  model: z.string().default(''),
  /** Reasoning-effort hint passed to the provider. `auto` lets the provider
   *  pick its default. */
  effort: z.enum(EFFORT_VALUES).default('auto'),
  /** Built-in role identity for this persona ("You are a senior front-end
   *  developer …"). Read-only for built-ins; also used as the seed value
   *  for a user's editable `projectDirections` in `.annotask/agents.json`
   *  so the panel starts with copy the user can tweak. */
  roleDirections: z.string().default(''),
  /** Extra system-prompt fragment appended after the skill+companion bundle.
   *  Use for project-specific instructions like "always run lint after". */
  systemPromptExtras: z.string().default(''),
  /** True for user-cloned personas. The UI gates delete/rename on this. */
  isCustom: z.boolean().default(false),
})

export type PersonaConfig = z.infer<typeof PersonaConfigSchema>

/**
 * Five built-in personas covering all eight task types. Keep this list
 * stable — the ids are referenced from persisted `personaOverrides` maps,
 * so renaming an id orphans existing overrides.
 *
 * Defaults to `claude-local` because (a) it's the most polished local CLI
 * surface and (b) it can actually apply changes via its native file-edit
 * tools (per Phase 3). Users on codex-local / opencode-local can clone any
 * persona and swap the provider.
 */
export const BUILT_IN_PERSONAS: readonly PersonaConfig[] = [
  {
    id: 'general',
    name: 'Frontend Developer',
    description: 'Default for annotations and freeform requests.',
    taskTypes: ['annotation', 'section_request'],
    providerId: 'claude-local',
    model: '',
    effort: 'auto',
    roleDirections:
      'You are a senior front-end developer. You write idiomatic, modular code that follows the project\'s framework conventions (Vue, React, Svelte, SolidJS, Astro, or plain HTML), match existing patterns, and keep changes small and reviewable. You prefer editing existing files over creating new ones and avoid speculative abstractions.',
    systemPromptExtras: '',
    isCustom: false,
  },
  {
    id: 'designer',
    name: 'Designer',
    description: 'CSS, design tokens, and visual styling work.',
    taskTypes: ['style_update', 'theme_update'],
    providerId: 'claude-local',
    model: '',
    effort: 'medium',
    roleDirections:
      'You are a UI/UX designer who codes. You translate visual edits into clean CSS and design-token changes, respect the project\'s existing tokens and theme variables, avoid hard-coded colors when a token exists, and keep typography, spacing, and color usage consistent across the app.',
    systemPromptExtras: '',
    isCustom: false,
  },
  {
    id: 'a11y',
    name: 'Accessibility',
    description: 'WCAG fixes from the a11y scanner.',
    taskTypes: ['a11y_fix'],
    providerId: 'claude-local',
    model: '',
    effort: 'high',
    roleDirections:
      'You are a web accessibility expert fluent in WCAG 2.2, WAI-ARIA, and assistive-tech behavior. You produce minimal, semantically correct fixes — prefer native HTML semantics over ARIA, preserve keyboard navigation and focus order, and verify color-contrast and label associations rather than guessing.',
    systemPromptExtras: '',
    isCustom: false,
  },
  {
    id: 'bug-hunter',
    name: 'Bug Hunter',
    description: 'Console errors and performance findings.',
    taskTypes: ['error_fix', 'perf_fix'],
    providerId: 'claude-local',
    model: '',
    effort: 'high',
    roleDirections:
      'You are an expert at diagnosing runtime errors and performance regressions. You read stack traces and Web Vitals carefully, fix root causes rather than symptoms, avoid swallowing errors, and only add error handling at real boundaries. You measure before optimizing and prefer targeted fixes over broad refactors.',
    systemPromptExtras: '',
    isCustom: false,
  },
]

/**
 * Resolve a task type to a persona. Priority:
 *   1. Explicit `personaOverrides[taskType]` mapping (user-pinned).
 *   2. Any persona whose `taskTypes` includes the type.
 *   3. The `general` built-in (catch-all fallback).
 *   4. `null` when even `general` is missing — caller falls back to global
 *      activeProvider/model/effort.
 */
export function resolvePersonaForTaskType(
  personas: readonly PersonaConfig[],
  taskType: TaskType | string | undefined,
  overrides: Record<string, string> = {},
): PersonaConfig | null {
  if (!taskType) {
    return personas.find(p => p.id === 'general') ?? personas[0] ?? null
  }
  const overrideId = overrides[taskType]
  if (overrideId) {
    const pinned = personas.find(p => p.id === overrideId)
    if (pinned) return pinned
  }
  const match = personas.find(p => (p.taskTypes as readonly string[]).includes(taskType))
  if (match) return match
  return personas.find(p => p.id === 'general') ?? null
}

/** Per-agent overrides keyed by persona id. Sourced from
 *  `.annotask/agents.json` at the shell layer. Only the fields the user has
 *  set are present; missing ones inherit from the built-in persona. */
export interface PersonaRuntimeOverride {
  providerId?: ProviderId
  model?: string
  effort?: EffortLevel
}

/**
 * Merge built-ins with user customs, deduping by id. User customs win — this
 * lets a user clone a built-in and reassign its task types without removing
 * the original (the original keeps existing as a fallback). v1 simpler
 * behavior: customs sit alongside built-ins and the resolver picks the
 * first match in array order.
 *
 * `overrides` applies on top of built-ins (never customs) so the per-project
 * `agents.json` can swap provider/model/effort for the read-only built-ins
 * without forcing the user to clone them.
 */
export function combinePersonas(
  custom: readonly PersonaConfig[],
  overrides: Record<string, PersonaRuntimeOverride> = {},
): PersonaConfig[] {
  const out: PersonaConfig[] = []
  const seen = new Set<string>()
  for (const p of BUILT_IN_PERSONAS) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    const o = overrides[p.id]
    if (!o) { out.push(p); continue }
    out.push({
      ...p,
      providerId: o.providerId ?? p.providerId,
      model: typeof o.model === 'string' ? o.model : p.model,
      effort: o.effort ?? p.effort,
    })
  }
  for (const p of custom) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    out.push(p)
  }
  return out
}

export type { TaskType }
