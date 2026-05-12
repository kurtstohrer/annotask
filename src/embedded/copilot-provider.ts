/**
 * GitHub Copilot Chat provider.
 *
 * Ports the auth flow used by `sst/opencode`:
 *   1. Read the user's GitHub OAuth token from `~/.config/github-copilot/`
 *      (`apps.json` on newer Copilot installs, `hosts.json` on older).
 *   2. Exchange that OAuth token for a short-lived Copilot session token via
 *      `GET https://api.github.com/copilot_internal/v2/token`.
 *   3. Use the session token against `https://api.githubcopilot.com/chat/completions`
 *      with the Chat Completions wire format and Copilot-specific editor
 *      headers.
 *
 * This is the well-known contract between Copilot's session-token exchange
 * and its chat endpoint; if GitHub re-shapes either side, the smoke test
 * (`__tests__/copilot-smoke.test.ts`, run on demand) is what catches it.
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  ChatCompletionsProvider,
  type ChatCompletionsTransport,
  type ChatCompletionsRequest,
} from './chat-completions.js'

const SESSION_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token'
const DEFAULT_CHAT_ENDPOINT = 'https://api.githubcopilot.com/chat/completions'
const DEFAULT_MODEL = 'gpt-4o'
const DEFAULT_MAX_TOKENS = 4096
const EDITOR_VERSION = 'annotask/0.1'
const EDITOR_PLUGIN_VERSION = 'annotask-embedded/0.1'
const COPILOT_INTEGRATION_ID = 'vscode-chat'
const USER_AGENT = 'GithubCopilot/annotask'
const TOKEN_REFRESH_SLACK_MS = 60_000

export interface CopilotSessionToken {
  /** Bearer token to send to the Copilot chat endpoint. */
  token: string
  /** Unix seconds when the token expires. */
  expiresAt: number
  /** Optional override of the chat endpoint base URL. */
  chatEndpoint?: string
}

export interface CopilotProviderOptions {
  /** Override the OAuth token instead of reading the config file. Mostly for
   *  tests; in production callers should let the provider auto-discover. */
  oauthToken?: string
  /** Override the Copilot config dir (defaults to `~/.config/github-copilot`).
   *  Useful for tests and for Windows users on non-standard layouts. */
  configDir?: string
  /** Override the chat endpoint URL (handles users behind a proxy). */
  chatEndpoint?: string
  defaultModel?: string
  defaultMaxTokens?: number
  /** Editor stamp used in the request headers — Copilot rejects calls
   *  without it. Override if you need to spoof a specific editor. */
  editorVersion?: string
  editorPluginVersion?: string
  copilotIntegrationId?: string
  /** Test seam: inject a transport. When set, no token exchange happens. */
  transport?: ChatCompletionsTransport
  /** Test seam: inject a pre-built session-token resolver, used to verify
   *  refresh logic without making real HTTP calls. */
  sessionTokenResolver?: () => Promise<CopilotSessionToken>
}

export class CopilotProvider extends ChatCompletionsProvider {
  constructor(opts: CopilotProviderOptions = {}) {
    const transport = opts.transport ?? buildCopilotTransport(opts)
    super({
      name: 'copilot',
      transport,
      defaultModel: opts.defaultModel ?? DEFAULT_MODEL,
      defaultMaxTokens: opts.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
      shapeRequest: stripUnsupportedFields,
    })
  }
}

/**
 * Copilot's chat endpoint rejects a few of the optional fields we send to
 * OpenAI proper (notably `stream_options.include_usage` in some rollouts).
 * Strip them so the request body is the conservative intersection.
 */
function stripUnsupportedFields(body: ChatCompletionsRequest): ChatCompletionsRequest {
  const { stream_options: _stream_options, ...rest } = body
  return rest as ChatCompletionsRequest
}

function buildCopilotTransport(opts: CopilotProviderOptions): ChatCompletionsTransport {
  const resolver = opts.sessionTokenResolver ?? createDefaultResolver(opts)
  const cache = new TokenCache(resolver)
  const editorVersion = opts.editorVersion ?? EDITOR_VERSION
  const editorPluginVersion = opts.editorPluginVersion ?? EDITOR_PLUGIN_VERSION
  const copilotIntegrationId = opts.copilotIntegrationId ?? COPILOT_INTEGRATION_ID

  return async (body, signal) => {
    const session = await cache.get()
    const endpoint = opts.chatEndpoint ?? session.chatEndpoint ?? DEFAULT_CHAT_ENDPOINT
    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Editor-Version': editorVersion,
      'Editor-Plugin-Version': editorPluginVersion,
      'Copilot-Integration-Id': copilotIntegrationId,
      'User-Agent': USER_AGENT,
      'OpenAI-Intent': 'conversation-panel',
    }
    return fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })
  }
}

/** Caches the Copilot session token and refreshes when it nears expiry. */
class TokenCache {
  private current: CopilotSessionToken | null = null
  private pending: Promise<CopilotSessionToken> | null = null

  constructor(private readonly resolver: () => Promise<CopilotSessionToken>) {}

  async get(): Promise<CopilotSessionToken> {
    if (this.current && !this.isExpired(this.current)) return this.current
    if (this.pending) return this.pending
    this.pending = (async () => {
      try {
        const next = await this.resolver()
        this.current = next
        return next
      } finally {
        this.pending = null
      }
    })()
    return this.pending
  }

  private isExpired(token: CopilotSessionToken): boolean {
    const expMs = token.expiresAt * 1000
    return Date.now() > expMs - TOKEN_REFRESH_SLACK_MS
  }
}

function createDefaultResolver(
  opts: CopilotProviderOptions,
): () => Promise<CopilotSessionToken> {
  return async () => {
    const oauthToken = opts.oauthToken ?? (await readOAuthToken(opts.configDir))
    return exchangeOAuthForSessionToken(oauthToken, {
      editorVersion: opts.editorVersion ?? EDITOR_VERSION,
      editorPluginVersion: opts.editorPluginVersion ?? EDITOR_PLUGIN_VERSION,
    })
  }
}

/**
 * Read the OAuth token from the Copilot config files. Tries `apps.json` first
 * (used by `gh auth login --web` and the newer Copilot CLI), falling back to
 * `hosts.json` (older clients).
 */
export async function readOAuthToken(
  configDir: string = path.join(os.homedir(), '.config', 'github-copilot'),
): Promise<string> {
  const candidates = ['apps.json', 'hosts.json']
  const errors: string[] = []
  for (const name of candidates) {
    const file = path.join(configDir, name)
    try {
      const raw = await fs.readFile(file, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, { oauth_token?: string, token?: string }>
      for (const entry of Object.values(parsed)) {
        const token = entry?.oauth_token ?? entry?.token
        if (typeof token === 'string' && token.length > 0) return token
      }
      errors.push(`${name} had no oauth_token`)
    } catch (err: any) {
      if (err?.code === 'ENOENT') continue
      errors.push(`${name}: ${err?.message ?? String(err)}`)
    }
  }
  throw new Error(
    `[annotask] No GitHub Copilot OAuth token found under ${configDir}. ` +
      `Sign in with the GitHub Copilot extension or \`gh auth login\` first.` +
      (errors.length > 0 ? ` (${errors.join('; ')})` : ''),
  )
}

/**
 * Exchange a GitHub OAuth token for a short-lived Copilot session token.
 * Exposed for the smoke test and for ops scripts that want to verify auth
 * out-of-band without sending a full chat call.
 */
export async function exchangeOAuthForSessionToken(
  oauthToken: string,
  opts: { editorVersion?: string, editorPluginVersion?: string } = {},
): Promise<CopilotSessionToken> {
  const res = await fetch(SESSION_TOKEN_URL, {
    method: 'GET',
    headers: {
      Authorization: `token ${oauthToken}`,
      Accept: 'application/json',
      'Editor-Version': opts.editorVersion ?? EDITOR_VERSION,
      'Editor-Plugin-Version': opts.editorPluginVersion ?? EDITOR_PLUGIN_VERSION,
      'User-Agent': USER_AGENT,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `[annotask] Copilot session-token exchange failed: HTTP ${res.status} ${text.slice(0, 256)}`,
    )
  }
  const body = (await res.json()) as {
    token?: string
    expires_at?: number
    endpoints?: { api?: string }
  }
  if (!body.token || typeof body.expires_at !== 'number') {
    throw new Error(
      '[annotask] Copilot session-token response missing `token`/`expires_at` — ' +
        'GitHub may have changed the contract; run the Copilot smoke test.',
    )
  }
  const api = body.endpoints?.api
  return {
    token: body.token,
    expiresAt: body.expires_at,
    chatEndpoint: api ? `${api.replace(/\/+$/, '')}/chat/completions` : undefined,
  }
}
