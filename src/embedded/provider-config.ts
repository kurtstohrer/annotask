/**
 * Provider configuration for the embedded chat surface.
 *
 * Storage posture:
 * - Lives entirely in the user's browser (localStorage or whatever sink the
 *   shell injects). Never transmitted to any Annotask service.
 * - Secrets (API keys, OAuth tokens) sit alongside non-secrets so the user
 *   has one place to configure the embedded chat.
 *
 * Branches:
 * - Direct-API providers (anthropic, openai, openai-compatible, openrouter,
 *   paperclip) carry their own credentials in this blob.
 * - Local-CLI providers (claude-local, codex-local, opencode-local,
 *   copilot-local) carry NO credentials — they reuse the locally-installed
 *   CLI's own login state (~/.claude, ~/.codex, ~/.copilot, …). The shell's
 *   `agent-detect` endpoint reports whether the CLI is installed and logged in.
 *
 * Per-provider knobs:
 * - `model` — empty string means "auto" (the provider picks). Otherwise the
 *   exact identifier (e.g. `claude-sonnet-4-5`, `openai/gpt-4o-mini`).
 * - `effort` — reasoning effort knob. `auto` means "don't send a hint at
 *   all"; `minimal | low | medium | high` map to provider-specific fields
 *   (`reasoning_effort` for OpenAI-compat, `thinking` budget for Anthropic,
 *   `-c model_reasoning_effort` for codex CLI). Providers that don't grok
 *   the hint just ignore it.
 *
 * The schema is intentionally narrow. New auth modes get a new discriminated
 * union branch rather than free-form fields.
 */

import { z } from 'zod'

export const PROVIDER_IDS = [
  // Local-CLI providers (reuse the CLI's own login state — no API keys here).
  'claude-local',
  'codex-local',
  'opencode-local',
  'copilot-local',
  // Direct-API providers
  'anthropic',
  'openai',
  'openrouter',
  'openai-compatible',
  'paperclip',
] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

export const ProviderIdSchema = z.enum(PROVIDER_IDS)

export const EFFORT_LEVELS = ['auto', 'minimal', 'low', 'medium', 'high'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]
export const EffortSchema = z.enum(EFFORT_LEVELS).default('auto')

/**
 * Curated list of well-known models per CLI provider for the model picker
 * dropdown in Settings → Agents and the init wizard. Acts as a typeable
 * combobox suggestion list — the underlying input still accepts any string,
 * so users on bleeding-edge or self-hosted models can paste a custom id.
 *
 * Keep this list short and authoritative — only include current production
 * model ids. Local CLIs that wrap multiple subproviders (opencode) should
 * stay empty so the picker degrades to a free-text input.
 */
export const MODELS_BY_PROVIDER: Partial<Record<ProviderId, readonly string[]>> = {
  'claude-local': [
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ],
  'codex-local': [
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
  ],
  'opencode-local': [],
  anthropic: [
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ],
  openai: [
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'o3-mini',
  ],
  openrouter: [
    'anthropic/claude-sonnet-4.6',
    'openai/gpt-5',
    'openai/gpt-5-mini',
  ],
}

/**
 * Subset of EFFORT_LEVELS each provider actually honors. Providers not listed
 * inherit the full list. The picker filters to this slice so users can't
 * select an effort the provider would silently drop.
 */
export const EFFORTS_BY_PROVIDER: Partial<Record<ProviderId, readonly EffortLevel[]>> = {
  // Local CLIs that wrap their own model_reasoning_effort flag — full slate.
  'claude-local': ['auto', 'minimal', 'low', 'medium', 'high'],
  'codex-local':  ['auto', 'minimal', 'low', 'medium', 'high'],
  // OpenCode dispatches to subproviders; effort hint is best-effort only.
  'opencode-local': ['auto', 'low', 'medium', 'high'],
  // Copilot CLI exposes `--reasoning-effort low|medium|high|xhigh`. We only
  // forward the levels common across providers; xhigh is opt-in via extraArgs.
  'copilot-local': ['auto', 'low', 'medium', 'high'],
  anthropic: ['auto', 'minimal', 'low', 'medium', 'high'],
  openai:    ['auto', 'minimal', 'low', 'medium', 'high'],
  openrouter:['auto', 'low', 'medium', 'high'],
}

/**
 * Agent mode — how aggressive the in-shell chat should be:
 *   - `auto`: every newly-created task auto-opens its Conversation tab and
 *     fires the first turn with the task description. Hands-free.
 *   - `manual` (default): the Conversation tab is available but only fires
 *     when the user clicks the Run-with-agent button on a task (or the
 *     batch Run-pending button on the tasks list). Manual control.
 *   - `off`: no in-shell chat surface at all. Users drive agents via the
 *     terminal — `/annotask-apply`, MCP, the `annotask` CLI.
 */
export const AGENT_MODES = ['auto', 'manual', 'off'] as const
export type AgentMode = (typeof AGENT_MODES)[number]
export const AgentModeSchema = z.enum(AGENT_MODES).default('auto')

const TrimmedString = z.string().trim()
const NonEmptyTrimmed = TrimmedString.min(1, 'value cannot be empty')

/**
 * URL validator that accepts http(s) URLs only and rejects auth credentials
 * in the URL itself. We deliberately allow custom hosts (localhost, LAN
 * IPs, hostnames) because opencode and LM Studio commonly run on
 * `http://localhost:4096` and similar.
 */
const EndpointUrl = NonEmptyTrimmed.superRefine((value, ctx) => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Must be a valid URL.',
    })
    return
  }
  if (!/^https?:$/.test(url.protocol)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Only http(s) URLs are supported.',
    })
  }
  if (url.username || url.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Embed credentials via the API key field, not the URL.',
    })
  }
})

/** Local-CLI provider config — the same shape for claude/codex/opencode/copilot. */
function localCliSchema<T extends 'claude-local' | 'codex-local' | 'opencode-local' | 'copilot-local'>(id: T) {
  return z.object({
    id: z.literal(id),
    /** Empty string means "auto" (let the CLI pick its default model). */
    model: TrimmedString.default(''),
    effort: EffortSchema,
    /** Extra args appended after the canonical args. Trim+filter empty. */
    extraArgs: z.array(TrimmedString).default([]),
  })
}

export const ClaudeLocalProviderConfigSchema = localCliSchema('claude-local')
export type ClaudeLocalProviderConfig = z.infer<typeof ClaudeLocalProviderConfigSchema>

export const CodexLocalProviderConfigSchema = localCliSchema('codex-local')
export type CodexLocalProviderConfig = z.infer<typeof CodexLocalProviderConfigSchema>

export const OpencodeLocalProviderConfigSchema = localCliSchema('opencode-local')
export type OpencodeLocalProviderConfig = z.infer<typeof OpencodeLocalProviderConfigSchema>

/**
 * GitHub Copilot CLI (`copilot`) — subprocess provider. Same shape as the
 * other local-CLI configs: no credentials stored here, the CLI manages its
 * own auth (OS keyring or `~/.copilot/`). Lets users with a working
 * `copilot login` skip the HTTP `/copilot_internal/v2/token` flow, which
 * rejects tokens issued by anything other than the Copilot IDE OAuth app.
 */
export const CopilotLocalProviderConfigSchema = localCliSchema('copilot-local')
export type CopilotLocalProviderConfig = z.infer<typeof CopilotLocalProviderConfigSchema>

/**
 * Anthropic provider — BYOK only. Keys start with `sk-ant-`; we accept any
 * non-empty trimmed string and rely on the live `validate()` call to verify
 * against the real API.
 */
export const AnthropicProviderConfigSchema = z.object({
  id: z.literal('anthropic'),
  apiKey: TrimmedString.default(''),
  model: TrimmedString.default(''),
  effort: EffortSchema,
})
export type AnthropicProviderConfig = z.infer<typeof AnthropicProviderConfigSchema>

/**
 * OpenAI / Codex provider — BYOK with optional org id.
 */
export const OpenAIProviderConfigSchema = z.object({
  id: z.literal('openai'),
  apiKey: TrimmedString.default(''),
  /** Optional organization id (`org-…`). */
  organization: TrimmedString.default(''),
  model: TrimmedString.default(''),
  effort: EffortSchema,
})
export type OpenAIProviderConfig = z.infer<typeof OpenAIProviderConfigSchema>

/**
 * OpenRouter — OpenAI-compatible router with a single API key and a fixed
 * default base URL. Behaves like `openai-compatible` but is tagged so the
 * UI can show OpenRouter-specific affordances (model picker, free-credit
 * hint) and the provider can inject the recommended attribution headers.
 */
export const OpenRouterProviderConfigSchema = z.object({
  id: z.literal('openrouter'),
  apiKey: TrimmedString.default(''),
  /** Allow override for self-hosted gateways; defaults to api.openrouter.ai. */
  baseUrl: TrimmedString.default(''),
  model: TrimmedString.default(''),
  effort: EffortSchema,
})
export type OpenRouterProviderConfig = z.infer<typeof OpenRouterProviderConfigSchema>

/**
 * OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, …).
 * `endpointUrl` is mandatory for this branch.
 */
export const OpenAICompatibleProviderConfigSchema = z.object({
  id: z.literal('openai-compatible'),
  endpointUrl: EndpointUrl,
  apiKey: TrimmedString.default(''),
  model: NonEmptyTrimmed,
  effort: EffortSchema,
  /** Friendly label for the UI, e.g. "Ollama local". */
  label: TrimmedString.default(''),
})
export type OpenAICompatibleProviderConfig = z.infer<
  typeof OpenAICompatibleProviderConfigSchema
>

/**
 * Paperclip-managed inference. The user pastes a Paperclip company API key
 * (or runs `pnpm paperclipai connect`). The shell never stores Paperclip
 * credentials past this field.
 */
export const PaperclipProviderConfigSchema = z.object({
  id: z.literal('paperclip'),
  companyId: TrimmedString.default(''),
  apiKey: TrimmedString.default(''),
  /** Override the Paperclip API base URL (e.g. self-hosted instance). */
  apiBaseUrl: TrimmedString.default(''),
  model: TrimmedString.default(''),
  effort: EffortSchema,
})
export type PaperclipProviderConfig = z.infer<typeof PaperclipProviderConfigSchema>

export const ProviderConfigSchema = z.discriminatedUnion('id', [
  ClaudeLocalProviderConfigSchema,
  CodexLocalProviderConfigSchema,
  OpencodeLocalProviderConfigSchema,
  CopilotLocalProviderConfigSchema,
  AnthropicProviderConfigSchema,
  OpenAIProviderConfigSchema,
  OpenRouterProviderConfigSchema,
  OpenAICompatibleProviderConfigSchema,
  PaperclipProviderConfigSchema,
])
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

const DEFAULT_CLAUDE_LOCAL: ClaudeLocalProviderConfig = {
  id: 'claude-local',
  model: '',
  effort: 'auto',
  extraArgs: [],
}
const DEFAULT_CODEX_LOCAL: CodexLocalProviderConfig = {
  id: 'codex-local',
  model: '',
  effort: 'auto',
  extraArgs: [],
}
const DEFAULT_OPENCODE_LOCAL: OpencodeLocalProviderConfig = {
  id: 'opencode-local',
  model: '',
  effort: 'auto',
  extraArgs: [],
}
const DEFAULT_COPILOT_LOCAL: CopilotLocalProviderConfig = {
  id: 'copilot-local',
  model: '',
  effort: 'auto',
  extraArgs: [],
}
const DEFAULT_ANTHROPIC: AnthropicProviderConfig = {
  id: 'anthropic',
  apiKey: '',
  model: '',
  effort: 'auto',
}
const DEFAULT_OPENAI: OpenAIProviderConfig = {
  id: 'openai',
  apiKey: '',
  organization: '',
  model: '',
  effort: 'auto',
}
const DEFAULT_OPENROUTER: OpenRouterProviderConfig = {
  id: 'openrouter',
  apiKey: '',
  baseUrl: '',
  model: '',
  effort: 'auto',
}
const DEFAULT_OPENAI_COMPATIBLE = {
  id: 'openai-compatible' as const,
  endpointUrl: '',
  apiKey: '',
  model: '',
  label: '',
  effort: 'auto' as EffortLevel,
}
const DEFAULT_PAPERCLIP: PaperclipProviderConfig = {
  id: 'paperclip',
  companyId: '',
  apiKey: '',
  apiBaseUrl: '',
  model: '',
  effort: 'auto',
}

/**
 * Shape of the persisted settings blob. The active provider id selects
 * which entry in `providers` is currently in use; the other branches stay
 * populated so the user can flip between providers without re-entering
 * credentials.
 */
// Personas are defined in persona.ts to keep the heavy task-type list out of
// the provider-config surface. We import the schema and re-export the type
// from this module so persisted settings carry a strongly-typed personas[].
import { PersonaConfigSchema } from './persona.js'

export const ProviderSettingsSchema = z.object({
  /** Provider currently selected for new conversations. */
  activeProvider: ProviderIdSchema.default('claude-local'),
  /**
   * Agent mode (auto | manual | off). See `AgentModeSchema` for semantics.
   * Defaults to `manual` so the in-shell chat is available but won't fire
   * unprompted — autonomous behavior is opt-in.
   */
  agentMode: AgentModeSchema,
  /** True once the user has dismissed the first-run setup modal. */
  onboardingDismissed: z.boolean().default(false),
  /** Toggle to disable redaction in *the user's own* config (testing only). */
  redactionEnabled: z.boolean().default(true),
  /** Local event log toggle. Defaults on. Logged data never leaves the box. */
  eventLogEnabled: z.boolean().default(true),
  /** Stored config per provider. Branches the user hasn't touched stay at defaults. */
  providers: z
    .object({
      'claude-local': ClaudeLocalProviderConfigSchema.default(DEFAULT_CLAUDE_LOCAL),
      'codex-local': CodexLocalProviderConfigSchema.default(DEFAULT_CODEX_LOCAL),
      'opencode-local': OpencodeLocalProviderConfigSchema.default(DEFAULT_OPENCODE_LOCAL),
      'copilot-local': CopilotLocalProviderConfigSchema.default(DEFAULT_COPILOT_LOCAL),
      anthropic: AnthropicProviderConfigSchema.default(DEFAULT_ANTHROPIC),
      openai: OpenAIProviderConfigSchema.default(DEFAULT_OPENAI),
      openrouter: OpenRouterProviderConfigSchema.default(DEFAULT_OPENROUTER),
      'openai-compatible': z
        .object({
          id: z.literal('openai-compatible'),
          endpointUrl: TrimmedString.default(''),
          apiKey: TrimmedString.default(''),
          model: TrimmedString.default(''),
          label: TrimmedString.default(''),
          effort: EffortSchema,
        })
        .default(DEFAULT_OPENAI_COMPATIBLE),
      paperclip: PaperclipProviderConfigSchema.default(DEFAULT_PAPERCLIP),
    })
    .default(() => ({
      'claude-local': DEFAULT_CLAUDE_LOCAL,
      'codex-local': DEFAULT_CODEX_LOCAL,
      'opencode-local': DEFAULT_OPENCODE_LOCAL,
      'copilot-local': DEFAULT_COPILOT_LOCAL,
      anthropic: DEFAULT_ANTHROPIC,
      openai: DEFAULT_OPENAI,
      openrouter: DEFAULT_OPENROUTER,
      'openai-compatible': DEFAULT_OPENAI_COMPATIBLE,
      paperclip: DEFAULT_PAPERCLIP,
    })),
  /**
   * User-defined personas. Built-ins live in src/embedded/persona.ts and
   * are merged at read time. This array only holds the user's customs +
   * any built-ins the user explicitly edited. Empty means "use built-ins
   * as-is."
   */
  customPersonas: z.array(PersonaConfigSchema).default([]),
  /**
   * Task-type → persona-id pins. Override the natural `taskTypes[]`-based
   * routing for the named type. Used by the Agents settings UI to let
   * users reassign (e.g. force `a11y_fix` to the Designer persona).
   */
  personaOverrides: z.record(z.string(), z.string()).default({}),
})
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  // Default to claude-local — paperclip rule: prefer the user's logged-in CLI.
  // If `claude` isn't installed/logged in, the detect banner steers the user
  // to whichever local CLI *is* available; the chat composer also surfaces
  // the "pick a provider" empty state.
  activeProvider: 'claude-local',
  agentMode: 'auto',
  onboardingDismissed: false,
  redactionEnabled: true,
  eventLogEnabled: true,
  providers: {
    'claude-local': DEFAULT_CLAUDE_LOCAL,
    'codex-local': DEFAULT_CODEX_LOCAL,
    'opencode-local': DEFAULT_OPENCODE_LOCAL,
    'copilot-local': DEFAULT_COPILOT_LOCAL,
    anthropic: DEFAULT_ANTHROPIC,
    openai: DEFAULT_OPENAI,
    openrouter: DEFAULT_OPENROUTER,
    'openai-compatible': DEFAULT_OPENAI_COMPATIBLE,
    paperclip: DEFAULT_PAPERCLIP,
  },
  customPersonas: [],
  personaOverrides: {},
}

/**
 * Validate a single provider config branch and return either a parsed
 * config or a list of human-readable issues. The `openai-compatible`
 * branch's endpoint URL is validated strictly here even though it accepts
 * empty defaults in storage — callers who *use* the provider must pass a
 * filled-in endpoint URL.
 */
export function validateProviderConfig(
  config: ProviderConfig,
): { ok: true; config: ProviderConfig } | { ok: false; errors: string[] } {
  let schema: z.ZodTypeAny
  switch (config.id) {
    case 'claude-local':
      schema = ClaudeLocalProviderConfigSchema
      break
    case 'codex-local':
      schema = CodexLocalProviderConfigSchema
      break
    case 'opencode-local':
      schema = OpencodeLocalProviderConfigSchema
      break
    case 'copilot-local':
      schema = CopilotLocalProviderConfigSchema
      break
    case 'anthropic':
      schema = AnthropicProviderConfigSchema
      break
    case 'openai':
      schema = OpenAIProviderConfigSchema
      break
    case 'openrouter':
      schema = OpenRouterProviderConfigSchema
      break
    case 'openai-compatible':
      schema = OpenAICompatibleProviderConfigSchema
      break
    case 'paperclip':
      schema = PaperclipProviderConfigSchema
      break
  }
  const parsed = schema.safeParse(config)
  if (parsed.success) return { ok: true, config: parsed.data as ProviderConfig }
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => {
      const path = i.path.length > 0 ? `${i.path.join('.')}: ` : ''
      return `${path}${i.message}`
    }),
  }
}

/**
 * Parse a stored settings blob (e.g. from localStorage). Falls back to
 * `DEFAULT_PROVIDER_SETTINGS` on any error so the shell never gets stuck
 * with a corrupt config.
 */
export function parseProviderSettings(raw: unknown): ProviderSettings {
  if (raw == null) return DEFAULT_PROVIDER_SETTINGS
  let input: unknown = raw
  if (typeof raw === 'string') {
    try {
      input = JSON.parse(raw)
    } catch {
      return DEFAULT_PROVIDER_SETTINGS
    }
  }
  // Migrate the removed `copilot` (HTTP/OAuth) provider id to `copilot-local`
  // so users who previously selected it land on the CLI subprocess instead of
  // losing their entire settings blob on the enum-rejection fallback.
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (obj.activeProvider === 'copilot') obj.activeProvider = 'copilot-local'
    if (obj.providers && typeof obj.providers === 'object') {
      delete (obj.providers as Record<string, unknown>).copilot
    }
  }
  const parsed = ProviderSettingsSchema.safeParse(input)
  if (!parsed.success) return DEFAULT_PROVIDER_SETTINGS
  // Merge the parsed result over the hand-built defaults so any provider
  // branch the user has never touched still has a usable default. zod 4's
  // nested .default() only fires when the parent key is missing, not when
  // it is present but partially-populated.
  return {
    activeProvider: parsed.data.activeProvider,
    agentMode: parsed.data.agentMode,
    onboardingDismissed: parsed.data.onboardingDismissed,
    redactionEnabled: parsed.data.redactionEnabled,
    eventLogEnabled: parsed.data.eventLogEnabled,
    providers: {
      ...DEFAULT_PROVIDER_SETTINGS.providers,
      ...parsed.data.providers,
    },
    customPersonas: parsed.data.customPersonas ?? [],
    personaOverrides: parsed.data.personaOverrides ?? {},
  }
}

/**
 * Probe for local-CLI providers. Each entry is true iff `agent-detect`
 * reports the CLI installed AND logged in. Callers (the composer's "ready"
 * check, the runtime factory) inject a fresh probe; pass an empty object
 * when probing isn't available (treats local providers as not-ready).
 */
export interface LocalCliReadiness {
  'claude-local'?: boolean
  'codex-local'?: boolean
  'opencode-local'?: boolean
  'copilot-local'?: boolean
}

/**
 * Return true when the given settings blob has enough credentials for the
 * active provider to actually run. Useful for the "Run" button gating in
 * the composer. Local-CLI providers need an extra `probe` from agent-detect
 * since their "credentials" live in the user's home directory, not here.
 */
export function isActiveProviderReady(
  settings: ProviderSettings,
  probe: LocalCliReadiness = {},
): boolean {
  const active = settings.providers[settings.activeProvider]
  switch (active.id) {
    case 'claude-local':
    case 'codex-local':
    case 'opencode-local':
    case 'copilot-local':
      return probe[active.id] === true
    case 'anthropic':
      return active.apiKey.trim().length > 0
    case 'openai':
      return active.apiKey.trim().length > 0
    case 'openrouter':
      return active.apiKey.trim().length > 0
    case 'openai-compatible': {
      const result = OpenAICompatibleProviderConfigSchema.safeParse(active)
      return result.success
    }
    case 'paperclip':
      return active.apiKey.trim().length > 0
  }
}

/**
 * Redact secret fields for safe logging. Returns a shallow copy with
 * sensitive fields replaced by `'<set>'` / `'<unset>'` markers.
 */
export function redactForLogging(settings: ProviderSettings): unknown {
  const mask = (v: string) => (v.length > 0 ? '<set>' : '<unset>')
  return {
    activeProvider: settings.activeProvider,
    agentMode: settings.agentMode,
    onboardingDismissed: settings.onboardingDismissed,
    redactionEnabled: settings.redactionEnabled,
    eventLogEnabled: settings.eventLogEnabled,
    providers: {
      'claude-local': {
        id: 'claude-local',
        model: settings.providers['claude-local'].model,
        effort: settings.providers['claude-local'].effort,
        extraArgs: settings.providers['claude-local'].extraArgs,
      },
      'codex-local': {
        id: 'codex-local',
        model: settings.providers['codex-local'].model,
        effort: settings.providers['codex-local'].effort,
        extraArgs: settings.providers['codex-local'].extraArgs,
      },
      'opencode-local': {
        id: 'opencode-local',
        model: settings.providers['opencode-local'].model,
        effort: settings.providers['opencode-local'].effort,
        extraArgs: settings.providers['opencode-local'].extraArgs,
      },
      'copilot-local': {
        id: 'copilot-local',
        model: settings.providers['copilot-local'].model,
        effort: settings.providers['copilot-local'].effort,
        extraArgs: settings.providers['copilot-local'].extraArgs,
      },
      anthropic: {
        id: 'anthropic',
        apiKey: mask(settings.providers.anthropic.apiKey),
        model: settings.providers.anthropic.model,
        effort: settings.providers.anthropic.effort,
      },
      openai: {
        id: 'openai',
        apiKey: mask(settings.providers.openai.apiKey),
        organization: settings.providers.openai.organization,
        model: settings.providers.openai.model,
        effort: settings.providers.openai.effort,
      },
      openrouter: {
        id: 'openrouter',
        apiKey: mask(settings.providers.openrouter.apiKey),
        baseUrl: settings.providers.openrouter.baseUrl,
        model: settings.providers.openrouter.model,
        effort: settings.providers.openrouter.effort,
      },
      'openai-compatible': {
        id: 'openai-compatible',
        endpointUrl: settings.providers['openai-compatible'].endpointUrl,
        apiKey: mask(settings.providers['openai-compatible'].apiKey),
        model: settings.providers['openai-compatible'].model,
        effort: settings.providers['openai-compatible'].effort,
        label: settings.providers['openai-compatible'].label,
      },
      paperclip: {
        id: 'paperclip',
        companyId: settings.providers.paperclip.companyId,
        apiKey: mask(settings.providers.paperclip.apiKey),
        apiBaseUrl: settings.providers.paperclip.apiBaseUrl,
        model: settings.providers.paperclip.model,
        effort: settings.providers.paperclip.effort,
      },
    },
  }
}
