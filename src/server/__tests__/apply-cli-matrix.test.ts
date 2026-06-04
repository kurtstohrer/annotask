/**
 * LIVE task-apply e2e smoke — all 4 local CLIs against the marketing playground.
 *
 * Proves the *apply* half of the embedded-agent feature end to end: a real
 * pending design task is handed to a real local CLI, the CLI edits the project
 * source, the change lands on disk, and the task advances to `review`. This is
 * the live counterpart to the mocked `useEmbeddedAgent` unit tests and the
 * init-only `init-cli-matrix-stress.test.ts`.
 *
 * Resettable target: each CLI gets an isolated temp copy of the marketing
 * playground materialized from the `demo/marketing-before` git tag (the flawed
 * "AI first-draft" state) — so runs are repeatable and never touch the working
 * tree. Discarded after each run (keep with ANNOTASK_CLI_MATRIX_KEEP=1).
 *
 * Permission: we deliberately pass NO permissionMode, so each provider falls
 * back to its Auto default (`defaultPermissionModeFor`): claude/opencode →
 * bypass, codex/copilot → sandboxed/minimal. This asserts the *safe out-of-box
 * default actually applies a task* on every CLI.
 *
 * Skipped by default. Enable with ANNOTASK_LIVE_CLI=1:
 *   ANNOTASK_LIVE_CLI=1 pnpm test:apply-matrix
 *   ANNOTASK_LIVE_CLI=1 ANNOTASK_LIVE_ONLY=claude,codex pnpm test:apply-matrix
 */
import { describe, it, expect, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createAgentSpawnHandler } from '../agent-spawn.js'
import { createAgentDetector } from '../agent-detect.js'
import { createProjectState } from '../state.js'
import { ClaudeLocalProvider } from '../../embedded/claude-local-provider.js'
import { CodexLocalProvider } from '../../embedded/codex-local-provider.js'
import { OpencodeLocalProvider } from '../../embedded/opencode-local-provider.js'
import { CopilotLocalProvider } from '../../embedded/copilot-local-provider.js'
import type { LLMProvider, ProviderEvent } from '../../embedded/provider.js'
import {
  LIVE_CLI_ENABLED,
  isLiveCliEnabled,
  liveModelFor,
  type LiveProviderKey,
} from '../../embedded/__tests__/live-cli-helpers.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const BEFORE_TAG = 'demo/marketing-before'
const MARKETING_REL = 'playgrounds/simple/marketing'

const KEEP_WORKSPACES = process.env.ANNOTASK_CLI_MATRIX_KEEP === '1'
const CLI_KEYS: LiveProviderKey[] = ['claude-local', 'codex-local', 'opencode-local', 'copilot-local']
const describeIf = LIVE_CLI_ENABLED ? describe : describe.skip
const PER_CLI_TIMEOUT_MS = 6 * 60_000

/** Materialize one file from the demo/marketing-before tag (the flawed baseline). */
function fileFromBeforeTag(relInPlayground: string): string {
  return execFileSync('git', ['show', `${BEFORE_TAG}:${MARKETING_REL}/${relInPlayground}`], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 8 * 1024 * 1024,
  })
}

/** The seeded "real issue": the hero CTA buttons are cramped. A deterministic
 *  style_update so the assertion is unambiguous. */
function seedTaskPayload(): Record<string, unknown> {
  return {
    type: 'style_update',
    description: 'The hero CTA buttons feel cramped — give them more vertical padding and round the corners a little more.',
    file: 'src/style.css',
    line: 58,
    context: {
      changes: [
        { element: '.btn', property: 'padding', before: '11px 20px', after: '14px 20px' },
        { element: '.btn', property: 'border-radius', before: '10px', after: '12px' },
      ],
    },
  }
}

function buildApplyPrompts(task: { id: string; type: string; description: string; file: string; context?: { changes?: Array<Record<string, string>> } }) {
  const systemPrompt = [
    'You are an automated UI-fix agent applying ONE design task to a local web project.',
    'Use your file-editing tools to change the project source so the task is satisfied.',
    'Make ONLY the change the task describes. Do not start a dev server, do not ask questions,',
    'do not touch unrelated files. When the edit is saved to disk, you are done — stop.',
  ].join('\n')
  const changes = (task.context?.changes ?? [])
    .map((c) => `  - ${c.element} ${c.property}: \`${c.before}\` -> \`${c.after}\``)
    .join('\n')
  const userPrompt = [
    'Apply this pending Annotask design task, then stop.',
    '',
    `Task ${task.id} (${task.type}): ${task.description}`,
    '',
    `Edit this exact file in your current working directory: ${task.file}`,
    'That file exists in THIS project — open and edit it directly. Do NOT search the',
    'filesystem for other stylesheets or edit any file outside this project root.',
    'Make exactly these CSS changes to the `.btn` rule:',
    changes,
  ].join('\n')
  return { systemPrompt, userPrompt }
}

function buildProvider(key: LiveProviderKey, model: string, spawnUrl: string): LLMProvider {
  switch (key) {
    case 'claude-local':   return new ClaudeLocalProvider({ model, spawnUrl })
    case 'opencode-local': return new OpencodeLocalProvider({ model, spawnUrl })
    case 'codex-local':    return new CodexLocalProvider({ model, spawnUrl })
    case 'copilot-local':  return new CopilotLocalProvider({ model, spawnUrl })
  }
}

describeIf('apply CLI matrix — marketing playground (live)', () => {
  const createdRoots: string[] = []
  const detector = createAgentDetector()

  afterAll(async () => {
    if (KEEP_WORKSPACES) return
    for (const root of createdRoots) {
      await fsp.rm(root, { recursive: true, force: true }).catch(() => { /* best effort */ })
    }
  })

  async function probe(key: LiveProviderKey): Promise<{ runnable: boolean; reason?: string }> {
    const snap = await detector.detect()
    const s = snap[key]
    if (!s.found) return { runnable: false, reason: `${key} CLI not on PATH` }
    if (!s.loggedIn) return { runnable: false, reason: `${key} CLI is installed but not logged in` }
    return { runnable: true }
  }

  async function runApply(key: LiveProviderKey): Promise<void> {
    const probed = await probe(key)
    if (!probed.runnable) {
      // eslint-disable-next-line no-console
      console.warn(`[apply] ${key} skipped: ${probed.reason}`)
      return
    }

    // 1. Isolated temp workspace. Copy the WHOLE marketing playground (minus
    //    node_modules/.annotask/dist/.git) so the CLI sees a real project root
    //    (package.json) and resolves files relative to it — without this anchor,
    //    opencode falls back to a default project root and edits the wrong tree.
    //    Then overwrite the two editable files with the flawed "before" baseline.
    const ws = await fsp.mkdtemp(path.join(os.tmpdir(), `annotask-apply-${key}-`))
    createdRoots.push(ws)
    await fsp.cp(path.join(REPO_ROOT, MARKETING_REL), ws, {
      recursive: true,
      filter: (src) => !/[/\\](node_modules|\.annotask|dist|\.git)([/\\]|$)/.test(src),
    })
    await fsp.writeFile(path.join(ws, 'index.html'), fileFromBeforeTag('index.html'))
    await fsp.writeFile(path.join(ws, 'src', 'style.css'), fileFromBeforeTag('src/style.css'))
    // Make the temp dir a real git repo so each CLI's project-root + file-search
    // is scoped HERE. Without a .git, opencode walks up, finds none, and falls
    // back to a default project (the real annotask repo) — editing the wrong tree.
    const git = (args: string[]) => execFileSync('git', args, { cwd: ws, stdio: 'ignore' })
    git(['init', '-q'])
    git(['add', '-A'])
    git(['-c', 'user.email=ci@annotask.test', '-c', 'user.name=annotask-ci', 'commit', '-q', '-m', 'baseline'])
    const cssPath = path.join(ws, 'src', 'style.css')
    const before = await fsp.readFile(cssPath, 'utf-8')

    // 2. Seed a real pending task, then lock it (pending -> in_progress),
    //    mirroring the embedded runner's lockTaskOnStart.
    const state = createProjectState(ws, () => { /* no ws broadcast in tests */ })
    const task = (await state.addTask(seedTaskPayload())) as { id: string; type: string; description: string; file: string; context?: { changes?: Array<Record<string, string>> } }
    await state.updateTask(task.id, { status: 'in_progress' })

    // 3. Spawn server bound to THIS workspace (handleSpawn cwd = ws).
    const handler = createAgentSpawnHandler()
    const server = http.createServer(async (req, res) => {
      if (req.url !== '/__annotask/api/agent/spawn' || req.method !== 'POST') {
        res.statusCode = 404; res.end(); return
      }
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      let parsed: unknown
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')) }
      catch { res.statusCode = 400; res.end('bad json'); return }
      await handler.handleSpawn(req, res, parsed, ws)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const spawnUrl = `http://127.0.0.1:${port}/__annotask/api/agent/spawn`

    try {
      // 4. Drive the real CLI through the provider — NO permissionMode, so it
      //    uses the safe Auto default (the thing we want to prove applies tasks).
      const model = liveModelFor(key)
      const provider = buildProvider(key, model, spawnUrl)
      const { systemPrompt, userPrompt } = buildApplyPrompts(task)

      const started = Date.now()
      let sawDone = false, sawTool = false, usageIn = 0, usageOut = 0
      let errorString: string | null = null
      const textParts: string[] = []
      for await (const ev of provider.stream(
        [{ role: 'user', content: userPrompt }], [], { systemPrompt, model },
      ) as AsyncIterable<ProviderEvent>) {
        if (ev.type === 'text') textParts.push(ev.text)
        else if (ev.type === 'tool_call') sawTool = true
        else if (ev.type === 'usage') { usageIn += ev.inputTokens; usageOut += ev.outputTokens }
        else if (ev.type === 'done') sawDone = true
        else if (ev.type === 'error') errorString = ev.error
      }
      const elapsed = Date.now() - started

      // 5. Assert the edit actually landed in source — scoped to the base
      //    `.btn { … }` rule so an unrelated `12px`/`14px` elsewhere in the CSS
      //    can't produce a false positive. (`\.btn\s*\{` won't match `.btn.primary`.)
      const after = await fsp.readFile(cssPath, 'utf-8')
      const changed = after !== before
      const btnRule = after.match(/\.btn\s*\{[^}]*\}/)?.[0] ?? ''
      const hasPadding = /padding:\s*14px\s+20px/.test(btnRule)
      const hasRadius = /border-radius:\s*12px/.test(btnRule)

      // 6. Advance the task to review on a clean, correct apply (mirrors markTaskForReview).
      if (sawDone && changed && hasPadding && hasRadius) {
        await state.updateTask(task.id, { status: 'review', resolution: 'Applied button padding + radius.' })
      }
      const finalStatus = state.getTasks().tasks.find((t: { id: string }) => t.id === task.id)?.status

      // eslint-disable-next-line no-console
      console.log(
        `[apply] ${key} model=${model} ${elapsed}ms tokens=${usageIn}/${usageOut} ` +
        `done=${sawDone} tool=${sawTool} changed=${changed} padding=${hasPadding} radius=${hasRadius} status=${finalStatus}`,
      )
      if (!changed) {
        // eslint-disable-next-line no-console
        console.log(`[apply] ${key} DID NOT EDIT — agent text tail: ${JSON.stringify(textParts.join('').slice(-400))}`)
      }

      if (errorString) throw new Error(`[${key}] provider emitted error: ${errorString}`)
      expect(sawDone, `${key}: stream never emitted 'done'`).toBe(true)
      // The load-bearing proof is the on-disk edit, not the tool_call event:
      // copilot applies the change without surfacing tool_call events in its
      // stream, so `sawTool` is informational only (logged above).
      expect(changed, `${key}: src/style.css was not modified`).toBe(true)
      expect(hasPadding, `${key}: .btn padding 14px 20px was not applied`).toBe(true)
      expect(hasRadius, `${key}: .btn border-radius 12px was not applied`).toBe(true)
      expect(finalStatus, `${key}: task did not reach 'review'`).toBe('review')
    } finally {
      await state.flush()
      state.dispose()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  for (const key of CLI_KEYS) {
    const runner = isLiveCliEnabled(key) ? it.concurrent : it.skip
    runner(`${key} applies a style_update to real source`, () => runApply(key), PER_CLI_TIMEOUT_MS)
  }
})
