/**
 * LIVE design-session apply e2e — real local CLIs writing the session's
 * properties-panel edits into source, with the snapshot engine proving
 * byte-exact undo afterwards. The M4 acceptance counterpart to
 * `apply-cli-matrix.test.ts` (which covers classic style_update tasks).
 *
 * Flow per CLI: isolated temp Vue project → seed session entries (a literal
 * text edit + a literal prop edit) → applyDesignSession (snapshot + ONE
 * wireframe_apply task with context.session) → real CLI applies → task →
 * review → verifyAppliedEntries flips entries written → revertApplyBatch
 * restores the original bytes exactly.
 *
 * Skipped by default. Enable with ANNOTASK_LIVE_CLI=1:
 *   ANNOTASK_LIVE_CLI=1 npx vitest run src/server/__tests__/apply-session-matrix.test.ts
 *   ANNOTASK_LIVE_CLI=1 ANNOTASK_LIVE_ONLY=claude npx vitest run …
 */
import { describe, it, expect, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { createAgentSpawnHandler } from '../agent-spawn.js'
import { createAgentDetector } from '../agent-detect.js'
import { createProjectState } from '../state.js'
import { createSessionStore } from '../session-store.js'
import { createSnapshotStore } from '../file-snapshots.js'
import { applyDesignSession, verifyAppliedEntries, revertApplyBatch, type ApplySessionOptions } from '../apply-session.js'
import { clearBindingClassifyCache } from '../binding-classify.js'
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
import type { DesignSessionDocument, SessionEntry } from '../../shared/design-session-types.js'

const KEEP_WORKSPACES = process.env.ANNOTASK_CLI_MATRIX_KEEP === '1'
const CLI_KEYS: LiveProviderKey[] = ['claude-local', 'codex-local', 'opencode-local', 'copilot-local']
const describeIf = LIVE_CLI_ENABLED ? describe : describe.skip
const PER_CLI_TIMEOUT_MS = 6 * 60_000

const PAGE_VUE = `<template>
  <section class="planets-page">
    <h1 class="title">Planets</h1>
    <p class="subtitle">A tour of the solar system.</p>
    <BaseButton label="Reset" kind="ghost" />
  </section>
</template>

<script setup lang="ts">
import BaseButton from '../components/BaseButton.vue'
</script>
`

const BUTTON_VUE = `<script setup lang="ts">
defineProps<{ label: string; kind?: string }>()
</script>

<template>
  <button class="base-button" :data-kind="kind">{{ label }}</button>
</template>
`

function sessionEntries(): SessionEntry[] {
  return [
    {
      id: 'se-1', ordinal: 1, ts: 1, route: '/planets',
      change: {
        id: 'c-1', type: 'text_update', description: 'Change the page heading text to “Worlds”',
        file: 'src/pages/Page.vue', section: 'template', line: 3, element: 'h1',
        before: 'Planets', after: 'Worlds',
      } as SessionEntry['change'],
      anchor: { file: 'src/pages/Page.vue', line: 3, targetTag: 'h1' },
      evidence: { classification: 'literal' },
      live: { status: 'pending' },
    },
    {
      id: 'se-2', ordinal: 2, ts: 2, route: '/planets',
      change: {
        id: 'c-2', type: 'component_prop_update', description: 'Set BaseButton label to "Clear filters"',
        file: 'src/pages/Page.vue', section: 'template', line: 5, element: 'BaseButton',
        prop: 'label', before: 'Reset', after: 'Clear filters', binding: 'literal', propType: 'string',
      } as SessionEntry['change'],
      anchor: { file: 'src/pages/Page.vue', line: 5, targetTag: 'BaseButton' },
      evidence: { classification: 'literal' },
      live: { status: 'pending' },
    },
  ]
}

function buildPrompts(task: { id: string; description: string; file: string; context?: Record<string, unknown> }) {
  const session = (task.context as { session?: { entries?: Array<{ change: Record<string, unknown>; anchor: Record<string, unknown> }> } } | undefined)?.session
  const lines = (session?.entries ?? []).map((e) => {
    const c = e.change
    if (c.type === 'text_update') return `  - In ${e.anchor.file} line ${e.anchor.line}: change the <${c.element}> text from \`${c.before}\` to \`${c.after}\``
    return `  - In ${e.anchor.file} line ${e.anchor.line}: change <${c.element}> prop \`${c.prop}\` from \`${c.before}\` to \`${c.after}\` (plain literal attribute)`
  })
  const systemPrompt = [
    'You are an automated UI-fix agent applying ONE design-session task to a local web project.',
    'Use your file-editing tools to make exactly the listed edits. Do not start a dev server,',
    'do not ask questions, do not touch unrelated files or any file outside this project root.',
    'Never edit files under .annotask/. When the edits are saved to disk, you are done — stop.',
  ].join('\n')
  const userPrompt = [
    'Apply this pending Annotask design-session task, then stop.',
    '',
    `Task ${task.id}: ${task.description}`,
    '',
    'Make exactly these edits:',
    ...lines,
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

describeIf('design-session apply matrix (live)', () => {
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

  async function runSessionApply(key: LiveProviderKey): Promise<void> {
    const probed = await probe(key)
    if (!probed.runnable) {
      // eslint-disable-next-line no-console
      console.warn(`[apply-session] ${key} skipped: ${probed.reason}`)
      return
    }

    // 1. Isolated minimal Vue project (git-rooted so the CLI scopes here).
    const ws = await fsp.mkdtemp(path.join(os.tmpdir(), `annotask-session-${key}-`))
    createdRoots.push(ws)
    await fsp.mkdir(path.join(ws, 'src/pages'), { recursive: true })
    await fsp.mkdir(path.join(ws, 'src/components'), { recursive: true })
    await fsp.writeFile(path.join(ws, 'package.json'), JSON.stringify({ name: 'session-fixture', private: true }, null, 2))
    await fsp.writeFile(path.join(ws, 'src/pages/Page.vue'), PAGE_VUE)
    await fsp.writeFile(path.join(ws, 'src/components/BaseButton.vue'), BUTTON_VUE)
    const git = (args: string[]) => execFileSync('git', args, { cwd: ws, stdio: 'ignore' })
    git(['init', '-q'])
    git(['add', '-A'])
    git(['-c', 'user.email=ci@annotask.test', '-c', 'user.name=annotask-ci', 'commit', '-q', '-m', 'baseline'])
    const pagePath = path.join(ws, 'src/pages/Page.vue')

    // 2. Seed the session journal + real stores, then Apply (snapshot + task).
    const state = createProjectState(ws, () => { /* no ws broadcast in tests */ })
    const sessionStore = createSessionStore(ws)
    const current = await sessionStore.get()
    const doc: DesignSessionDocument = { version: '1.0', sessionId: 'ds-live', startedAt: 1, updatedAt: 1, rev: current.rev, entries: sessionEntries() }
    await sessionStore.set(doc)
    const options: ApplySessionOptions = {
      projectRoot: ws,
      getDesignSession: () => sessionStore.get(),
      setDesignSession: (d) => sessionStore.set(d),
      getWireframe: () => state.getWireframe(),
      setWireframe: (d) => state.setWireframe(d),
      addTask: (t) => state.addTask(t),
      snapshots: createSnapshotStore(ws),
    }
    const applied = await applyDesignSession(options, '/planets')
    expect('error' in applied).toBe(false)
    if ('error' in applied) return
    const task = state.getTasks().tasks.find((t) => t.id === applied.taskId) as { id: string; description: string; file: string; context?: Record<string, unknown> }
    await state.updateTask(task.id, { status: 'in_progress' })

    // 3. Spawn server bound to THIS workspace.
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
      // 4. Real CLI applies the session task (safe Auto permission default).
      const model = liveModelFor(key)
      const provider = buildProvider(key, model, spawnUrl)
      const { systemPrompt, userPrompt } = buildPrompts(task)
      let sawDone = false
      let errorString: string | null = null
      for await (const ev of provider.stream(
        [{ role: 'user', content: userPrompt }], [], { systemPrompt, model, taskId: task.id },
      ) as AsyncIterable<ProviderEvent>) {
        if (ev.type === 'done') sawDone = true
        else if (ev.type === 'error') errorString = ev.error
      }
      expect(errorString).toBeNull()
      expect(sawDone).toBe(true)

      // 5. Both edits landed in source.
      const after = await fsp.readFile(pagePath, 'utf-8')
      expect(after).toContain('Worlds')
      expect(after).toContain('Clear filters')

      // 6. review → verification flips entries written; the batch seals.
      await state.updateTask(task.id, { status: 'review' })
      clearBindingClassifyCache()
      await verifyAppliedEntries(options, task.id)
      const verified = await sessionStore.get()
      for (const e of verified.entries) {
        expect(e.live.status, `${key}: entry ${e.id} → ${JSON.stringify(e.live)}`).toBe('written')
      }

      // 7. Undo last apply: byte-exact restore.
      const undo = await revertApplyBatch(options, applied.batchId)
      expect(undo.skipped).toEqual([])
      expect(await fsp.readFile(pagePath, 'utf-8')).toBe(PAGE_VUE)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await state.flush()
      state.dispose()
    }
  }

  for (const key of CLI_KEYS) {
    it.skipIf(!isLiveCliEnabled(key))(
      `${key} applies a design session, verification marks entries written, undo restores bytes`,
      async () => { await runSessionApply(key) },
      PER_CLI_TIMEOUT_MS,
    )
  }

  // ── W3: wireframe directions (snapshot-sketch apply) ──────────────────────
  // The realistic /planets rearrangement from the handoff: move the grid above
  // the filters, add a "pagination here" placeholder, note on the filters.
  // Directions are trust-verified (no literal to look for) — the proof here is
  // the SOURCE: sibling order flipped, placeholder present, bytes restorable.

  const PAGE2_VUE = `<template>
  <section class="planets-page">
    <h1 class="title">Planets</h1>
    <section class="filters">
      <input class="search" placeholder="Search planets" />
      <select class="sort"><option>Distance</option><option>Name</option></select>
    </section>
    <div class="planet-grid">
      <article class="planet-card">Mercury</article>
      <article class="planet-card">Venus</article>
    </div>
  </section>
</template>
`

  function directionEntries(): SessionEntry[] {
    const base = { ordinal: 1, ts: 1, route: '/planets', live: { status: 'pending' as const } }
    return [
      {
        ...base, id: 'wd-grid-move',
        change: {
          id: 'c-wd-1', type: 'wireframe_direction', op: 'move',
          description: 'MOVE the planet-grid (src/pages/Page.vue:8): now above the filters (was below); position 0,180 → 0,90 (measured)',
          file: 'src/pages/Page.vue', section: 'template', line: 8,
          block: { label: 'planet-grid', tag: 'div' },
          measured: {
            before: { x: 0, y: 180, width: 800, height: 600 },
            after: { x: 0, y: 90, width: 800, height: 600 },
            dx: 0, dy: -90, relations: ['now above the filters (was below)'],
          },
        } as SessionEntry['change'],
        anchor: { file: 'src/pages/Page.vue', line: 8, targetTag: 'div' },
      },
      {
        ...base, id: 'wd-pagination', ordinal: 2, ts: 2,
        change: {
          id: 'c-wd-2', type: 'wireframe_direction', op: 'add',
          description: 'ADD placeholder "pagination here" (user-sketched box 360x80; keep it visibly a placeholder) after the planet-grid (src/pages/Page.vue:8)',
          file: 'src/pages/Page.vue', section: 'template', line: 8,
          block: { label: 'pagination here' },
          measured: { after: { x: 80, y: 710, width: 360, height: 80 } },
          added: { kind: 'placeholder', label: 'pagination here', position: 'after' },
        } as SessionEntry['change'],
        anchor: { file: 'src/pages/Page.vue', line: 8, targetTag: 'div' },
      },
      {
        ...base, id: 'wd-filters-note', ordinal: 3, ts: 3,
        change: {
          id: 'c-wd-3', type: 'wireframe_direction', op: 'note',
          description: 'NOTE on the filters (src/pages/Page.vue:4): user said: "put the search box and the sort dropdown on one row"',
          file: 'src/pages/Page.vue', section: 'template', line: 4,
          block: { label: 'filters', tag: 'section' },
          note: 'put the search box and the sort dropdown on one row',
        } as SessionEntry['change'],
        anchor: { file: 'src/pages/Page.vue', line: 4, targetTag: 'section' },
      },
    ]
  }

  function buildDirectionPrompts(task: { id: string; description: string }) {
    const systemPrompt = [
      'You are an automated UI agent implementing ONE Annotask wireframe task in a local web project.',
      'The user rearranged a snapshot sketch of the page; the task lists anchored directions.',
      'Pixel positions are hints — implement the INTENT with idiomatic layout (reorder siblings,',
      'flex/grid changes), never absolute positioning. Placeholders stay visibly labeled',
      'placeholders — never fabricate data. Use your file-editing tools; do not start a dev',
      'server, do not ask questions, never edit files under .annotask/. When the edits are',
      'saved to disk, you are done — stop.',
    ].join('\n')
    const userPrompt = [
      'Implement this pending Annotask wireframe task, then stop.',
      '',
      task.description,
    ].join('\n')
    return { systemPrompt, userPrompt }
  }

  async function runDirectionsApply(key: LiveProviderKey): Promise<void> {
    const probed = await probe(key)
    if (!probed.runnable) {
      // eslint-disable-next-line no-console
      console.warn(`[apply-session directions] ${key} skipped: ${probed.reason}`)
      return
    }

    const ws = await fsp.mkdtemp(path.join(os.tmpdir(), `annotask-directions-${key}-`))
    createdRoots.push(ws)
    await fsp.mkdir(path.join(ws, 'src/pages'), { recursive: true })
    await fsp.writeFile(path.join(ws, 'package.json'), JSON.stringify({ name: 'directions-fixture', private: true }, null, 2))
    await fsp.writeFile(path.join(ws, 'src/pages/Page.vue'), PAGE2_VUE)
    const git = (args: string[]) => execFileSync('git', args, { cwd: ws, stdio: 'ignore' })
    git(['init', '-q'])
    git(['add', '-A'])
    git(['-c', 'user.email=ci@annotask.test', '-c', 'user.name=annotask-ci', 'commit', '-q', '-m', 'baseline'])
    const pagePath = path.join(ws, 'src/pages/Page.vue')

    const state = createProjectState(ws, () => { /* no ws broadcast in tests */ })
    const sessionStore = createSessionStore(ws)
    const current = await sessionStore.get()
    const doc: DesignSessionDocument = { version: '1.0', sessionId: 'ds-directions', startedAt: 1, updatedAt: 1, rev: current.rev, entries: directionEntries() }
    await sessionStore.set(doc)
    const options: ApplySessionOptions = {
      projectRoot: ws,
      getDesignSession: () => sessionStore.get(),
      setDesignSession: (d) => sessionStore.set(d),
      getWireframe: () => state.getWireframe(),
      setWireframe: (d) => state.setWireframe(d),
      addTask: (t) => state.addTask(t),
      snapshots: createSnapshotStore(ws),
    }
    const applied = await applyDesignSession(options, '/planets')
    expect('error' in applied).toBe(false)
    if ('error' in applied) return
    const task = state.getTasks().tasks.find((t) => t.id === applied.taskId) as { id: string; description: string }
    expect(task.description).toContain('Implement the wireframe sketch on /planets')
    await state.updateTask(task.id, { status: 'in_progress' })

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
      const model = liveModelFor(key)
      const provider = buildProvider(key, model, spawnUrl)
      const { systemPrompt, userPrompt } = buildDirectionPrompts(task)
      let sawDone = false
      let errorString: string | null = null
      for await (const ev of provider.stream(
        [{ role: 'user', content: userPrompt }], [], { systemPrompt, model, taskId: task.id },
      ) as AsyncIterable<ProviderEvent>) {
        if (ev.type === 'done') sawDone = true
        else if (ev.type === 'error') errorString = ev.error
      }
      expect(errorString).toBeNull()
      expect(sawDone).toBe(true)

      // The INTENT landed: grid now precedes the filters; a visible pagination
      // placeholder exists. (The filters note is open-ended by design — its
      // success is not literally checkable, which is exactly why directions
      // are trust-verified.)
      const after = await fsp.readFile(pagePath, 'utf-8')
      expect(after.indexOf('planet-grid'), `${key}: grid must come before filters\n${after}`).toBeLessThan(after.indexOf('class="filters"'))
      expect(after).toMatch(/pagination/i)

      // review → directions flip written on trust; the batch seals.
      await state.updateTask(task.id, { status: 'review' })
      clearBindingClassifyCache()
      await verifyAppliedEntries(options, task.id)
      const verified = await sessionStore.get()
      for (const e of verified.entries) {
        expect(e.live.status, `${key}: entry ${e.id} → ${JSON.stringify(e.live)}`).toBe('written')
      }

      // Undo last apply: byte-exact restore.
      const undo = await revertApplyBatch(options, applied.batchId)
      expect(undo.skipped).toEqual([])
      expect(await fsp.readFile(pagePath, 'utf-8')).toBe(PAGE2_VUE)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await state.flush()
      state.dispose()
    }
  }

  for (const key of CLI_KEYS) {
    it.skipIf(!isLiveCliEnabled(key))(
      `${key} implements wireframe directions, trust-verify marks them written, undo restores bytes`,
      async () => { await runDirectionsApply(key) },
      PER_CLI_TIMEOUT_MS,
    )
  }
})
