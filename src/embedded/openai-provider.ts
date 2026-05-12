/**
 * OpenAI Chat Completions provider.
 *
 * Covers the OpenAI API and any user running Codex CLI on a personal key. The
 * Responses API surface is not implemented in v1 — Chat Completions is the
 * superset for tool-use streaming that everyone in the OpenAI ecosystem
 * supports today, including Codex which proxies through it.
 */

import {
  ChatCompletionsProvider,
  type ChatCompletionsTransport,
  createFetchTransport,
} from './chat-completions.js'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_MAX_TOKENS = 4096

export interface OpenAIProviderOptions {
  /** BYOK API key. Required unless a custom transport is injected. */
  apiKey?: string
  /** Override the base URL (defaults to api.openai.com/v1). */
  baseURL?: string
  /** Optional OpenAI organization id (`OpenAI-Organization` header). */
  organization?: string
  /** Optional OpenAI project id (`OpenAI-Project` header). */
  project?: string
  defaultModel?: string
  defaultMaxTokens?: number
  /** Test seam: inject a transport that returns a synthetic SSE Response. */
  transport?: ChatCompletionsTransport
}

export class OpenAIProvider extends ChatCompletionsProvider {
  constructor(opts: OpenAIProviderOptions = {}) {
    const transport = opts.transport ?? buildOpenAITransport(opts)
    super({
      name: 'openai',
      transport,
      defaultModel: opts.defaultModel ?? DEFAULT_MODEL,
      defaultMaxTokens: opts.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
    })
  }
}

function buildOpenAITransport(opts: OpenAIProviderOptions): ChatCompletionsTransport {
  const baseURL = (opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const endpoint = `${baseURL}/chat/completions`
  return createFetchTransport(endpoint, () => {
    if (!opts.apiKey) {
      throw new Error(
        '[annotask] OpenAIProvider requires `apiKey` (BYOK). The embedded runner never injects a shared key on the user\'s behalf.',
      )
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.apiKey}`,
    }
    if (opts.organization) headers['OpenAI-Organization'] = opts.organization
    if (opts.project) headers['OpenAI-Project'] = opts.project
    return headers
  })
}
