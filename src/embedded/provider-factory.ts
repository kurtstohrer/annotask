/**
 * Provider factory — given a parsed `ProviderSettings` blob, return the
 * concrete `LLMProvider` instance for the active provider.
 *
 * This is the single seam where "the user picked X" turns into "instantiate
 * class Y with credentials Z." Callers (`useEmbeddedAgent`, server-side
 * orchestrators, tests) get a uniform `LLMProvider` and never need to
 * branch on provider id themselves.
 *
 * The factory takes a small optional context object so the browser can pass
 * runtime details (referer, fetch override) without baking them into the
 * persisted settings blob.
 */

import type { LLMProvider } from './provider.js'
import type { ProviderSettings } from './provider-config.js'
import { AnthropicProvider } from './anthropic-provider.js'
import { OpenAIProvider } from './openai-provider.js'
import { OpenRouterProvider } from './openrouter-provider.js'
import { OpenAICompatibleProvider } from './openai-compatible-provider.js'
import { PaperclipProvider } from './paperclip-provider.js'
import { ClaudeLocalProvider } from './claude-local-provider.js'
import { CodexLocalProvider } from './codex-local-provider.js'
import { OpencodeLocalProvider } from './opencode-local-provider.js'
import { CopilotLocalProvider } from './copilot-local-provider.js'

export interface MakeProviderContext {
  /** OpenRouter attribution referer; defaults to window.location.origin. */
  referer?: string
  /** OpenRouter attribution app title; defaults to 'Annotask'. */
  appTitle?: string
  /** Spawn endpoint for CLI-local providers. Defaults to /__annotask/api/agent/spawn. */
  spawnUrl?: string
  /** Test seam: inject a custom fetch (also used by CLI-local providers). */
  fetchImpl?: typeof fetch
}

export function makeProvider(
  settings: ProviderSettings,
  ctx: MakeProviderContext = {},
): LLMProvider {
  const id = settings.activeProvider
  switch (id) {
    case 'claude-local': {
      const cfg = settings.providers['claude-local']
      return new ClaudeLocalProvider({
        model: cfg.model || undefined,
        extraArgs: cfg.extraArgs,
        spawnUrl: ctx.spawnUrl,
        fetchImpl: ctx.fetchImpl,
      })
    }
    case 'codex-local': {
      const cfg = settings.providers['codex-local']
      return new CodexLocalProvider({
        model: cfg.model || undefined,
        extraArgs: cfg.extraArgs,
        spawnUrl: ctx.spawnUrl,
        fetchImpl: ctx.fetchImpl,
      })
    }
    case 'opencode-local': {
      const cfg = settings.providers['opencode-local']
      return new OpencodeLocalProvider({
        model: cfg.model || undefined,
        extraArgs: cfg.extraArgs,
        spawnUrl: ctx.spawnUrl,
        fetchImpl: ctx.fetchImpl,
      })
    }
    case 'copilot-local': {
      const cfg = settings.providers['copilot-local']
      return new CopilotLocalProvider({
        model: cfg.model || undefined,
        extraArgs: cfg.extraArgs,
        spawnUrl: ctx.spawnUrl,
        fetchImpl: ctx.fetchImpl,
      })
    }
    case 'anthropic': {
      const cfg = settings.providers.anthropic
      return new AnthropicProvider({
        apiKey: cfg.apiKey,
        defaultModel: cfg.model || undefined,
      })
    }
    case 'openai': {
      const cfg = settings.providers.openai
      return new OpenAIProvider({
        apiKey: cfg.apiKey,
        organization: cfg.organization || undefined,
        defaultModel: cfg.model || undefined,
      })
    }
    case 'openrouter': {
      const cfg = settings.providers.openrouter
      return new OpenRouterProvider({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseUrl || undefined,
        defaultModel: cfg.model || undefined,
        referer: ctx.referer,
        appTitle: ctx.appTitle,
      })
    }
    case 'openai-compatible': {
      const cfg = settings.providers['openai-compatible']
      return new OpenAICompatibleProvider({
        baseURL: cfg.endpointUrl,
        apiKey: cfg.apiKey || undefined,
        defaultModel: cfg.model,
        name: cfg.label.trim() || undefined,
      })
    }
    case 'paperclip': {
      const cfg = settings.providers.paperclip
      // Build the Paperclip chat endpoint from the configured base URL.
      // The companyId is sent as a header so the same base URL can serve
      // multiple companies without per-company routing baked into the path.
      const base = (cfg.apiBaseUrl?.trim() || 'https://paperclip.ai/api').replace(/\/+$/, '')
      const headers: Record<string, string> = {}
      if (cfg.companyId) headers['X-Paperclip-Company-Id'] = cfg.companyId
      return new PaperclipProvider({
        endpoint: `${base}/chat/completions`,
        apiKey: cfg.apiKey,
        defaultModel: cfg.model || undefined,
        headers,
      })
    }
  }
}
