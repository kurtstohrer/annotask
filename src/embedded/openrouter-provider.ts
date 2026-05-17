/**
 * OpenRouter provider.
 *
 * OpenRouter speaks the OpenAI Chat Completions wire format, so this is a
 * thin specialisation: fixed default base URL, OpenRouter-recommended
 * attribution headers (`HTTP-Referer`, `X-Title`), and a default model
 * that's available on the free tier so first-run users see *something*
 * even before they pick a model.
 *
 * See https://openrouter.ai/docs#headers — the attribution headers are
 * optional, but recommended for app-level analytics on the OpenRouter side.
 */

import {
  ChatCompletionsProvider,
  type ChatCompletionsTransport,
  createFetchTransport,
} from './chat-completions.js'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'openai/gpt-4o-mini'
const DEFAULT_MAX_TOKENS = 4096

export interface OpenRouterProviderOptions {
  /** Required: the user's OpenRouter API key. */
  apiKey?: string
  /** Override the base URL (defaults to https://openrouter.ai/api/v1). */
  baseURL?: string
  /** Optional referer for OpenRouter analytics. Falls back to `http://localhost`. */
  referer?: string
  /** Optional app title for OpenRouter analytics. Falls back to `Annotask`. */
  appTitle?: string
  defaultModel?: string
  defaultMaxTokens?: number
  /** Test seam: inject a transport that returns a synthetic SSE Response. */
  transport?: ChatCompletionsTransport
}

export class OpenRouterProvider extends ChatCompletionsProvider {
  constructor(opts: OpenRouterProviderOptions = {}) {
    const transport = opts.transport ?? buildOpenRouterTransport(opts)
    super({
      name: 'openrouter',
      transport,
      defaultModel: opts.defaultModel ?? DEFAULT_MODEL,
      defaultMaxTokens: opts.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
    })
  }
}

function buildOpenRouterTransport(opts: OpenRouterProviderOptions): ChatCompletionsTransport {
  const baseURL = (opts.baseURL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const endpoint = `${baseURL}/chat/completions`
  return createFetchTransport(endpoint, () => {
    if (!opts.apiKey) {
      throw new Error(
        '[annotask] OpenRouterProvider requires `apiKey`. Get one at https://openrouter.ai/keys.',
      )
    }
    return {
      Authorization: `Bearer ${opts.apiKey}`,
      'HTTP-Referer': opts.referer || 'http://localhost',
      'X-Title': opts.appTitle || 'Annotask',
    }
  })
}
