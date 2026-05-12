/**
 * Paperclip-hosted chat provider.
 *
 * Posts to a configured Paperclip agent chat endpoint that speaks the OpenAI
 * Chat Completions wire format. The actual model behind the endpoint is
 * Paperclip-side configuration; this provider just brokers the conversation
 * and bearer auth.
 */

import {
  ChatCompletionsProvider,
  type ChatCompletionsRequest,
  type ChatCompletionsTransport,
  createFetchTransport,
} from './chat-completions.js'

const DEFAULT_MAX_TOKENS = 4096

export interface PaperclipProviderOptions {
  /** Required: full URL of the Paperclip chat endpoint (e.g.
   *  `https://paperclip.example.com/api/agents/<agent>/chat/completions`). */
  endpoint: string
  /** Required: bearer token for the Paperclip API. BYOK — Annotask never
   *  injects a shared key. */
  apiKey: string
  /** Model id to send. Paperclip-side maps this to the configured backing
   *  model; the default `'paperclip-default'` lets the server pick. */
  defaultModel?: string
  defaultMaxTokens?: number
  /** Optional extra headers (e.g. `X-Paperclip-Company-Id`). */
  headers?: Record<string, string>
  /** Hook to mutate the body before send. */
  shapeRequest?: (body: ChatCompletionsRequest) => ChatCompletionsRequest
  /** Test seam. */
  transport?: ChatCompletionsTransport
}

export class PaperclipProvider extends ChatCompletionsProvider {
  constructor(opts: PaperclipProviderOptions) {
    const transport = opts.transport ?? buildPaperclipTransport(opts)
    super({
      name: 'paperclip',
      transport,
      defaultModel: opts.defaultModel ?? 'paperclip-default',
      defaultMaxTokens: opts.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
      shapeRequest: opts.shapeRequest,
    })
  }
}

function buildPaperclipTransport(opts: PaperclipProviderOptions): ChatCompletionsTransport {
  if (!opts.endpoint) {
    throw new Error('[annotask] PaperclipProvider requires `endpoint`.')
  }
  if (!opts.apiKey) {
    throw new Error('[annotask] PaperclipProvider requires `apiKey` (BYOK).')
  }
  return createFetchTransport(opts.endpoint, () => ({
    Authorization: `Bearer ${opts.apiKey}`,
    ...(opts.headers ?? {}),
  }))
}
