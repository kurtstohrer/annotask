/**
 * Live provider streaming smoke pipeline.
 *
 * Connects to each CLI-backed provider for real (and Copilot via HTTP) and
 * verifies that text deltas plus a terminal `done` event come back through
 * the provider's stream(). Catches the failure mode the mocked tests can't:
 * a CLI that spawns fine but doesn't stream, or whose JSON shape has drifted
 * since the fixtures were written.
 *
 * Skipped by default. Enable with `ANNOTASK_LIVE_CLI=1`:
 *
 *   ANNOTASK_LIVE_CLI=1 pnpm test:live-providers
 *
 * Per-provider model overrides (see MODEL_CONFIG defaults below):
 *   ANNOTASK_LIVE_CLAUDE_MODEL
 *   ANNOTASK_LIVE_OPENCODE_MODEL
 *   ANNOTASK_LIVE_CODEX_MODEL
 *   ANNOTASK_LIVE_COPILOT_MODEL
 *
 * Filter which providers run (CSV, optional):
 *   ANNOTASK_LIVE_ONLY=claude,opencode
 */

import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { ClaudeLocalProvider } from '../claude-local-provider.js'
import { CodexLocalProvider } from '../codex-local-provider.js'
import { OpencodeLocalProvider } from '../opencode-local-provider.js'
import { CopilotLocalProvider } from '../copilot-local-provider.js'
import type { LLMProvider, ProviderEvent } from '../provider.js'

import { createAgentSpawnHandler } from '../../server/agent-spawn.js'
import { createAgentDetector } from '../../server/agent-detect.js'
import {
  LIVE_CLI_ENABLED,
  isLiveCliEnabled,
  liveModelFor,
  type LiveProviderKey,
} from './live-cli-helpers.js'

type ProviderKey = LiveProviderKey

const isEnabled = isLiveCliEnabled
const modelFor = liveModelFor

const describeIf = LIVE_CLI_ENABLED ? describe : describe.skip

describeIf('Live provider streaming smoke', () => {
  let server: http.Server
  let spawnUrl: string

  beforeAll(async () => {
    const handler = createAgentSpawnHandler()
    server = http.createServer(async (req, res) => {
      if (req.url !== '/__annotask/api/agent/spawn' || req.method !== 'POST') {
        res.statusCode = 404
        res.end()
        return
      }
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      let parsed: unknown
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')) }
      catch { res.statusCode = 400; res.end('bad json'); return }
      await handler.handleSpawn(req, res, parsed, process.cwd())
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    spawnUrl = `http://127.0.0.1:${port}/__annotask/api/agent/spawn`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const detector = createAgentDetector()

  async function probe(key: ProviderKey): Promise<{ runnable: boolean; reason?: string }> {
    const snap = await detector.detect()
    const s = snap[key]
    if (!s.found) return { runnable: false, reason: `${key} CLI not on PATH` }
    if (!s.loggedIn) return { runnable: false, reason: `${key} CLI is installed but not logged in` }
    return { runnable: true }
  }

  function buildProvider(key: ProviderKey, model: string): LLMProvider {
    switch (key) {
      case 'claude-local':   return new ClaudeLocalProvider({ model, spawnUrl })
      case 'opencode-local': return new OpencodeLocalProvider({ model, spawnUrl })
      case 'codex-local':    return new CodexLocalProvider({ model, spawnUrl })
      case 'copilot-local':  return new CopilotLocalProvider({ model, spawnUrl })
    }
  }

  async function runStreamingSmoke(key: ProviderKey): Promise<void> {
    const probed = await probe(key)
    if (!probed.runnable) {
      console.warn(`[live] ${key} skipped: ${probed.reason}`)
      return
    }

    const model = modelFor(key)
    const provider = buildProvider(key, model)
    const started = Date.now()
    let firstTextAt: number | null = null
    const textParts: string[] = []
    let usageIn = 0
    let usageOut = 0
    let stopReason: string | undefined
    let errorString: string | null = null
    let sawDone = false

    const iterable = provider.stream(
      [{ role: 'user', content: 'Reply with only the single word ok.' }],
      [],
      {
        systemPrompt: 'You are a terse echo bot. Reply with one word.',
        // CopilotProvider reads model from StreamOptions; CLI providers
        // ignore it and use their constructor-supplied model. Setting it
        // for both is harmless.
        model,
      },
    )

    for await (const ev of iterable as AsyncIterable<ProviderEvent>) {
      if (ev.type === 'text') {
        if (firstTextAt === null) firstTextAt = Date.now()
        textParts.push(ev.text)
      } else if (ev.type === 'usage') {
        usageIn += ev.inputTokens
        usageOut += ev.outputTokens
      } else if (ev.type === 'done') {
        sawDone = true
        stopReason = ev.stopReason
      } else if (ev.type === 'error') {
        errorString = ev.error
      }
    }

    const elapsed = Date.now() - started
    const firstTextMs = firstTextAt !== null ? firstTextAt - started : null
    const joined = textParts.join('').trim()
    console.log(
      `[live] ${key} model=${model} first-text=${firstTextMs ?? 'n/a'}ms ` +
      `total=${elapsed}ms tokens=${usageIn}/${usageOut} done=${stopReason ?? '?'} ` +
      `text=${JSON.stringify(joined.slice(0, 80))}`,
    )

    if (errorString) {
      throw new Error(`[${key}] provider emitted error: ${errorString}`)
    }
    expect(sawDone, `${key}: stream never emitted 'done'`).toBe(true)
    expect(textParts.length, `${key}: stream emitted no 'text' events`).toBeGreaterThan(0)
    expect(joined.length, `${key}: combined text was empty`).toBeGreaterThan(0)
  }

  it.runIf(isEnabled('claude-local'))(
    'claude-local streams a reply',
    () => runStreamingSmoke('claude-local'),
    120_000,
  )

  it.runIf(isEnabled('opencode-local'))(
    'opencode-local streams a reply',
    () => runStreamingSmoke('opencode-local'),
    120_000,
  )

  it.runIf(isEnabled('codex-local'))(
    'codex-local streams a reply',
    () => runStreamingSmoke('codex-local'),
    120_000,
  )

  it.runIf(isEnabled('copilot-local'))(
    'copilot-local streams a reply',
    () => runStreamingSmoke('copilot-local'),
    120_000,
  )
})
