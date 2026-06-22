export type {
  LLMProvider,
  ProviderMessage,
  ProviderContentBlock,
  ProviderRole,
  ProviderTool,
  ProviderEvent,
  StreamOptions,
} from './provider.js'

export {
  AnthropicProvider,
  buildAnthropicRequest,
  iterateAnthropicStream,
  type AnthropicClientLike,
  type AnthropicCreateParams,
  type AnthropicProviderOptions,
  type AnthropicStreamEvent,
} from './anthropic-provider.js'

export {
  ChatCompletionsProvider,
  buildChatCompletionsRequest,
  iterateChatCompletionsStream,
  createFetchTransport,
  type ChatCompletionsTransport,
  type ChatCompletionsRequest,
  type ChatCompletionsMessage,
  type ChatCompletionsTool,
  type ChatCompletionsToolCall,
  type ChatCompletionsChunk,
  type ChatCompletionsProviderConfig,
} from './chat-completions.js'

export { OpenAIProvider, type OpenAIProviderOptions } from './openai-provider.js'
export { OpenRouterProvider, type OpenRouterProviderOptions } from './openrouter-provider.js'
export {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from './openai-compatible-provider.js'
export { PaperclipProvider, type PaperclipProviderOptions } from './paperclip-provider.js'
export {
  CliLocalProvider,
  flattenMessagesAsPrompt,
  lastUserMessageText,
  type CliLocalProviderConfig,
  type ParsedLineResult,
  type SpawnRequest,
} from './cli-local-provider.js'
export {
  ClaudeLocalProvider,
  mapClaudeEvent,
  type ClaudeLocalProviderOptions,
} from './claude-local-provider.js'
export {
  CodexLocalProvider,
  mapCodexEvent,
  type CodexLocalProviderOptions,
} from './codex-local-provider.js'
export {
  OpencodeLocalProvider,
  mapOpencodeEvent,
  type OpencodeLocalProviderOptions,
} from './opencode-local-provider.js'

export { makeProvider, type MakeProviderContext } from './provider-factory.js'
