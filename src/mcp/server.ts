import type { IncomingMessage, ServerResponse } from 'node:http'
import { isLocalOrigin } from '../server/origin.js'
import { getSystemPrompt } from '../skills/index.js'
import { callTool, MCP_TOOLS, type McpDeps } from './tools.js'

export type { McpDeps } from './tools.js'

// ── Types ────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
  id?: string | number | null
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
  id: string | number | null
}

const PROTOCOL_VERSION = '2025-03-26'
declare const __ANNOTASK_VERSION__: string | undefined
const SERVER_INFO = { name: 'annotask', version: typeof __ANNOTASK_VERSION__ === 'string' ? __ANNOTASK_VERSION__ : '0.0.0' }

/** Cached `initialize.instructions` payload. The MCP server returns the
 *  `annotask-apply` skill as instructions so external agents (Claude Code,
 *  editors) get the same system prompt the embedded runner uses. */
let cachedInstructions: string | null = null
function getMcpInstructions(): string {
  if (cachedInstructions !== null) return cachedInstructions
  try {
    cachedInstructions = getSystemPrompt()
  } catch {
    cachedInstructions = ''
  }
  return cachedInstructions
}

// ── JSON-RPC dispatcher ──────────────────────────────

async function handleJsonRpc(req: JsonRpcRequest, deps: McpDeps): Promise<JsonRpcResponse | null> {
  if (req.id === undefined) return null

  switch (req.method) {
    case 'initialize': {
      const instructions = getMcpInstructions()
      const result: Record<string, unknown> = {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      }
      if (instructions) result.instructions = instructions
      return { jsonrpc: '2.0', result, id: req.id }
    }

    case 'ping':
      return { jsonrpc: '2.0', result: {}, id: req.id }

    case 'tools/list':
      return { jsonrpc: '2.0', result: { tools: MCP_TOOLS }, id: req.id }

    case 'tools/call': {
      const params = req.params as { name: string; arguments?: Record<string, unknown> } | undefined
      if (!params?.name) {
        return { jsonrpc: '2.0', error: { code: -32602, message: 'Missing tool name' }, id: req.id }
      }
      try {
        const result = await callTool(params.name, params.arguments ?? {}, deps)
        return { jsonrpc: '2.0', result, id: req.id }
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          result: { content: [{ type: 'text', text: `Tool error: ${err.message}` }], isError: true },
          id: req.id,
        }
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        error: { code: -32601, message: `Method not found: ${req.method}` },
        id: req.id,
      }
  }
}

// ── HTTP middleware (Streamable HTTP transport) ───────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_048_576) { req.destroy(); reject(new Error('Body too large')); return }
      body += chunk.toString()
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

export function createMcpMiddleware(deps: McpDeps) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/__annotask/mcp')) return next()

    if (!isLocalOrigin(req.headers.origin as string | undefined)) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    if (req.method === 'DELETE') {
      res.statusCode = 200
      res.end()
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('Allow', 'POST, DELETE')
      res.end()
      return
    }

    res.setHeader('Cache-Control', 'no-store')

    let raw: string
    try { raw = await readBody(req) } catch {
      res.statusCode = 413
      res.end()
      return
    }

    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }))
      return
    }

    // Batch request — isolate per-item exceptions so one bad message doesn't truncate the response
    if (Array.isArray(parsed)) {
      const responses: JsonRpcResponse[] = []
      for (const item of parsed) {
        let result: JsonRpcResponse | null = null
        try {
          result = await handleJsonRpc(item as JsonRpcRequest, deps)
        } catch (err: any) {
          const id = (item && typeof item === 'object' && 'id' in item) ? (item as any).id ?? null : null
          result = { jsonrpc: '2.0', error: { code: -32603, message: `Internal error: ${err?.message ?? String(err)}` }, id }
        }
        if (result) responses.push(result)
      }
      if (responses.length === 0) {
        res.statusCode = 202
        res.end()
      } else {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(responses))
      }
      return
    }

    const request = parsed as JsonRpcRequest
    if (request.id === undefined) {
      await handleJsonRpc(request, deps)
      res.statusCode = 202
      res.end()
      return
    }

    const response = await handleJsonRpc(request, deps)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
  }
}
