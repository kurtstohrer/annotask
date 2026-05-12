/**
 * OpenAI-compatible Chat Completions provider.
 *
 * Covers the long tail of endpoints that speak the OpenAI wire format with a
 * configurable base URL: `opencode` local server, Ollama (`/v1`), LM Studio,
 * vLLM, llama.cpp's `server`, any cloud relay, etc. Auth is intentionally
 * optional — Ollama and LM Studio commonly run with no key on localhost.
 */

import {
  ChatCompletionsProvider,
  type ChatCompletionsRequest,
  type ChatCompletionsTransport,
  createFetchTransport,
} from './chat-completions.js'

const DEFAULT_MAX_TOKENS = 4096

export interface OpenAICompatibleProviderOptions {
  /** Required: base URL of the OpenAI-compatible endpoint (e.g.
   *  `http://localhost:11434/v1` for Ollama, `http://localhost:1234/v1` for
   *  LM Studio, `http://localhost:4096` for opencode). */
  baseURL: string
  /** Optional bearer token. Many local endpoints accept any value or none. */
  apiKey?: string
  /** Required: model id to send (e.g. `llama3.1`, `qwen2.5-coder:14b`). The
   *  catalog is endpoint-specific, so we don't ship a default. */
  defaultModel: string
  /** Stable identifier surfaced in telemetry/UI. Defaults to
   *  `'openai-compatible'`; callers should set this to the specific runtime
   *  name (`'ollama'`, `'lmstudio'`, `'vllm'`, `'opencode'`) when they know
   *  it, so logs are readable. */
  name?: string
  /** Extra headers to send (e.g. `OpenAI-Beta`). */
  headers?: Record<string, string>
  /** Hook to mutate the request body — used to add knobs that some local
   *  servers require (`prompt_format`, `top_p`, etc.). */
  shapeRequest?: (body: ChatCompletionsRequest) => ChatCompletionsRequest
  defaultMaxTokens?: number
  /** Test seam: inject a transport. */
  transport?: ChatCompletionsTransport
}

export class OpenAICompatibleProvider extends ChatCompletionsProvider {
  constructor(opts: OpenAICompatibleProviderOptions) {
    const transport = opts.transport ?? buildOpenAICompatibleTransport(opts)
    super({
      name: opts.name ?? 'openai-compatible',
      transport,
      defaultModel: opts.defaultModel,
      defaultMaxTokens: opts.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
      shapeRequest: opts.shapeRequest,
    })
  }
}

function buildOpenAICompatibleTransport(
  opts: OpenAICompatibleProviderOptions,
): ChatCompletionsTransport {
  if (!opts.baseURL) {
    throw new Error('[annotask] OpenAICompatibleProvider requires a baseURL.')
  }
  const baseURL = opts.baseURL.replace(/\/+$/, '')
  const endpoint = `${baseURL}/chat/completions`
  return createFetchTransport(endpoint, () => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) }
    if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`
    return headers
  })
}
