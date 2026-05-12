/**
 * Provider configuration for the embedded chat surface.
 *
 * Storage posture:
 * - Lives entirely in the user's browser (localStorage or whatever sink the
 *   shell injects). Never transmitted to any Annotask service.
 * - Secrets (API keys, OAuth tokens) sit alongside non-secrets so the user
 *   has one place to configure the embedded chat.
 *
 * Why this module exists separately from `useAIConfig`:
 * - `useAIConfig` is Anthropic-only and ANN-3 era. M4 needs five providers
 *   plus auth modes (BYOK key, Copilot OAuth, Paperclip company link,
 *   custom OpenAI-compatible endpoint URL).
 * - The settings sheet (DesignEngineer) needs a single zod-validated source
 *   of truth it can bind to. UI churn must not invalidate stored configs.
 *
 * The schema is intentionally narrow. New auth modes get a new discriminated
 * union branch rather than free-form fields.
 */

import { z } from 'zod'

export const PROVIDER_IDS = [
  'anthropic',
  'openai',
  'openai-compatible',
  'copilot',
  'paperclip',
] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

export const ProviderIdSchema = z.enum(PROVIDER_IDS)

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

/**
 * Anthropic provider — BYOK only. Keys start with `sk-ant-`; we accept any
 * non-empty trimmed string and rely on the live `validate()` call to verify
 * against the real API.
 */
export const AnthropicProviderConfigSchema = z.object({
  id: z.literal('anthropic'),
  apiKey: TrimmedString.default(''),
  model: TrimmedString.default('claude-sonnet-4-5'),
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
  model: TrimmedString.default('gpt-5'),
})
export type OpenAIProviderConfig = z.infer<typeof OpenAIProviderConfigSchema>

/**
 * OpenAI-compatible endpoint (opencode, Ollama, LM Studio, vLLM, …).
 * `endpointUrl` is mandatory for this branch.
 */
export const OpenAICompatibleProviderConfigSchema = z.object({
  id: z.literal('openai-compatible'),
  endpointUrl: EndpointUrl,
  apiKey: TrimmedString.default(''),
  model: NonEmptyTrimmed,
  /** Friendly label for the UI, e.g. "opencode local". */
  label: TrimmedString.default(''),
})
export type OpenAICompatibleProviderConfig = z.infer<
  typeof OpenAICompatibleProviderConfigSchema
>

/**
 * GitHub Copilot via the device-code OAuth flow (port of opencode's auth).
 * The token field stores the short-lived OAuth access token; refresh is
 * handled by the provider itself. We store nothing here that the user
 * couldn't also retrieve from `~/.config/gh-copilot`.
 */
export const CopilotProviderConfigSchema = z.object({
  id: z.literal('copilot'),
  /** OAuth access token returned by GitHub. Empty until the user signs in. */
  oauthToken: TrimmedString.default(''),
  /** Wall-clock expiry of the access token (ms since epoch), if known. */
  expiresAt: z.number().int().nonnegative().optional(),
  model: TrimmedString.default('gpt-5'),
})
export type CopilotProviderConfig = z.infer<typeof CopilotProviderConfigSchema>

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
  model: TrimmedString.default('paperclip-default'),
})
export type PaperclipProviderConfig = z.infer<typeof PaperclipProviderConfigSchema>

export const ProviderConfigSchema = z.discriminatedUnion('id', [
  AnthropicProviderConfigSchema,
  OpenAIProviderConfigSchema,
  OpenAICompatibleProviderConfigSchema,
  CopilotProviderConfigSchema,
  PaperclipProviderConfigSchema,
])
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

/**
 * Shape of the persisted settings blob. The active provider id selects
 * which entry in `providers` is currently in use; the other branches stay
 * populated so the user can flip between providers without re-entering
 * credentials.
 */
export const ProviderSettingsSchema = z.object({
  /** Provider currently selected for new conversations. */
  activeProvider: ProviderIdSchema.default('anthropic'),
  /** Per-conversation USD cap (M4 acceptance). */
  perConversationCapUsd: z.number().positive().finite().default(0.5),
  /** Toggle to disable redaction in *the user's own* config (testing only). */
  redactionEnabled: z.boolean().default(true),
  /** Local event log toggle. Defaults on. Logged data never leaves the box. */
  eventLogEnabled: z.boolean().default(true),
  /** Stored config per provider. Branches the user hasn't touched stay at defaults. */
  providers: z
    .object({
      anthropic: AnthropicProviderConfigSchema.default({
        id: 'anthropic',
        apiKey: '',
        model: 'claude-sonnet-4-5',
      }),
      openai: OpenAIProviderConfigSchema.default({
        id: 'openai',
        apiKey: '',
        organization: '',
        model: 'gpt-5',
      }),
      'openai-compatible': z
        .object({
          id: z.literal('openai-compatible'),
          endpointUrl: TrimmedString.default(''),
          apiKey: TrimmedString.default(''),
          model: TrimmedString.default(''),
          label: TrimmedString.default(''),
        })
        .default({
          id: 'openai-compatible',
          endpointUrl: '',
          apiKey: '',
          model: '',
          label: '',
        }),
      copilot: CopilotProviderConfigSchema.default({
        id: 'copilot',
        oauthToken: '',
        model: 'gpt-5',
      }),
      paperclip: PaperclipProviderConfigSchema.default({
        id: 'paperclip',
        companyId: '',
        apiKey: '',
        apiBaseUrl: '',
        model: 'paperclip-default',
      }),
    })
    .default(() => ({
      anthropic: { id: 'anthropic' as const, apiKey: '', model: 'claude-sonnet-4-5' },
      openai: { id: 'openai' as const, apiKey: '', organization: '', model: 'gpt-5' },
      'openai-compatible': {
        id: 'openai-compatible' as const,
        endpointUrl: '',
        apiKey: '',
        model: '',
        label: '',
      },
      copilot: { id: 'copilot' as const, oauthToken: '', model: 'gpt-5' },
      paperclip: {
        id: 'paperclip' as const,
        companyId: '',
        apiKey: '',
        apiBaseUrl: '',
        model: 'paperclip-default',
      },
    })),
})
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  activeProvider: 'anthropic',
  perConversationCapUsd: 0.5,
  redactionEnabled: true,
  eventLogEnabled: true,
  providers: {
    anthropic: { id: 'anthropic', apiKey: '', model: 'claude-sonnet-4-5' },
    openai: { id: 'openai', apiKey: '', organization: '', model: 'gpt-5' },
    'openai-compatible': {
      id: 'openai-compatible',
      endpointUrl: '',
      apiKey: '',
      model: '',
      label: '',
    },
    copilot: { id: 'copilot', oauthToken: '', model: 'gpt-5' },
    paperclip: {
      id: 'paperclip',
      companyId: '',
      apiKey: '',
      apiBaseUrl: '',
      model: 'paperclip-default',
    },
  },
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
    case 'anthropic':
      schema = AnthropicProviderConfigSchema
      break
    case 'openai':
      schema = OpenAIProviderConfigSchema
      break
    case 'openai-compatible':
      schema = OpenAICompatibleProviderConfigSchema
      break
    case 'copilot':
      schema = CopilotProviderConfigSchema
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
  const parsed = ProviderSettingsSchema.safeParse(input)
  if (!parsed.success) return DEFAULT_PROVIDER_SETTINGS
  // Merge the parsed result over the hand-built defaults so any provider
  // branch the user has never touched still has a usable default. zod 4's
  // nested .default() only fires when the parent key is missing, not when
  // it is present but partially-populated.
  return {
    activeProvider: parsed.data.activeProvider,
    perConversationCapUsd: parsed.data.perConversationCapUsd,
    redactionEnabled: parsed.data.redactionEnabled,
    eventLogEnabled: parsed.data.eventLogEnabled,
    providers: {
      ...DEFAULT_PROVIDER_SETTINGS.providers,
      ...parsed.data.providers,
    },
  }
}

/**
 * Return true when the given settings blob has enough credentials for the
 * active provider to actually run. Useful for the "Run" button gating in
 * the composer.
 */
export function isActiveProviderReady(settings: ProviderSettings): boolean {
  const active = settings.providers[settings.activeProvider]
  switch (active.id) {
    case 'anthropic':
      return active.apiKey.trim().length > 0
    case 'openai':
      return active.apiKey.trim().length > 0
    case 'openai-compatible': {
      const result = OpenAICompatibleProviderConfigSchema.safeParse(active)
      return result.success
    }
    case 'copilot':
      return active.oauthToken.trim().length > 0
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
    perConversationCapUsd: settings.perConversationCapUsd,
    redactionEnabled: settings.redactionEnabled,
    eventLogEnabled: settings.eventLogEnabled,
    providers: {
      anthropic: {
        id: 'anthropic',
        apiKey: mask(settings.providers.anthropic.apiKey),
        model: settings.providers.anthropic.model,
      },
      openai: {
        id: 'openai',
        apiKey: mask(settings.providers.openai.apiKey),
        organization: settings.providers.openai.organization,
        model: settings.providers.openai.model,
      },
      'openai-compatible': {
        id: 'openai-compatible',
        endpointUrl: settings.providers['openai-compatible'].endpointUrl,
        apiKey: mask(settings.providers['openai-compatible'].apiKey),
        model: settings.providers['openai-compatible'].model,
        label: settings.providers['openai-compatible'].label,
      },
      copilot: {
        id: 'copilot',
        oauthToken: mask(settings.providers.copilot.oauthToken),
        expiresAt: settings.providers.copilot.expiresAt,
        model: settings.providers.copilot.model,
      },
      paperclip: {
        id: 'paperclip',
        companyId: settings.providers.paperclip.companyId,
        apiKey: mask(settings.providers.paperclip.apiKey),
        apiBaseUrl: settings.providers.paperclip.apiBaseUrl,
        model: settings.providers.paperclip.model,
      },
    },
  }
}
