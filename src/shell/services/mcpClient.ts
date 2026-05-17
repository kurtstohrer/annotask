/**
 * Browser-side MCP client. The embedded agent uses the same JSON-RPC endpoint
 * that external editor agents (Claude Code, Cursor, Windsurf) hit, so there's
 * one tool dispatcher serving both worlds. See src/mcp/tools.ts for the
 * authoritative tool list and handlers.
 *
 * Wire format: Streamable HTTP transport, POST /__annotask/mcp with one
 * JSON-RPC request per call. Batches are supported by the server but we don't
 * need them here — the embedded agent dispatches one tool at a time.
 */

export interface McpToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpToolContent {
  type: string
  text?: string
  data?: string
  mimeType?: string
}

export interface McpToolResult {
  content: McpToolContent[]
  isError?: boolean
}

const ENDPOINT = '/__annotask/mcp'

let cachedCatalog: McpToolDescriptor[] | null = null
let inFlight: Promise<McpToolDescriptor[]> | null = null

async function rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
  const body = {
    jsonrpc: '2.0',
    method,
    params,
    id: Date.now(),
  }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`MCP transport error: ${res.status} ${res.statusText}`)
  }
  const payload = await res.json() as { result?: T; error?: { code: number; message: string } }
  if (payload.error) {
    throw new Error(`MCP error ${payload.error.code}: ${payload.error.message}`)
  }
  return payload.result as T
}

/**
 * Fetch the MCP tool catalog. Cached for the lifetime of the page — the
 * catalog is static within a dev-server lifetime; restart the dev server to
 * pick up tool changes.
 */
export async function fetchMcpToolCatalog(): Promise<McpToolDescriptor[]> {
  if (cachedCatalog) return cachedCatalog
  if (inFlight) return inFlight
  inFlight = (async () => {
    const result = await rpc<{ tools: McpToolDescriptor[] }>('tools/list')
    cachedCatalog = result.tools
    return cachedCatalog
  })()
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

/**
 * Dispatch one MCP tool. Returns the result envelope verbatim so callers can
 * surface `isError` to the agent.
 */
export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  return rpc<McpToolResult>('tools/call', { name, arguments: args })
}

/** Test hook: drop the cached catalog so the next call re-fetches. */
export function resetMcpCatalogCache(): void {
  cachedCatalog = null
}
