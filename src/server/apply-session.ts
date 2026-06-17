import fsp from 'node:fs/promises'
import path from 'node:path'
import { RevConflictError } from './json-cas-store.js'
import { WireframeRevConflictError } from './wireframe-store.js'
import { classifyBindings } from './binding-classify.js'
import { resolveProjectFile } from './path-safety.js'
import type { SnapshotStore } from './file-snapshots.js'
import type { DesignSessionDocument, SessionEntry } from '../shared/design-session-types.js'
import type { WireframeDocument, WireframeInstance } from '../shared/wireframe-types.js'

/**
 * Agent-apply orchestration — the server half of "Apply now".
 *
 * The tool never authors application source. An apply batch:
 *   1. collects the session's pending entries + the route's placed instances,
 *   2. snapshots every file they touch (the byte-exact undo/discard net),
 *   3. creates ONE wireframe_apply task carrying context.wireframe (the
 *      placements, exactly as Build always has) + context.session (the
 *      properties-panel edits),
 *   4. stamps instances 'building' and entries 'applying'.
 * The SHELL then drives the embedded agent on that task through the existing
 * spawn pipeline (auto-run); when the agent flips the task to 'review', the
 * verification pass below re-reads the source per entry and marks each one
 * written | failed, then seals the batch's post-apply hashes.
 */

export interface ApplySessionOptions {
  projectRoot: string
  getDesignSession: () => Promise<DesignSessionDocument>
  setDesignSession: (doc: DesignSessionDocument) => Promise<DesignSessionDocument>
  getWireframe: () => Promise<WireframeDocument>
  setWireframe: (doc: WireframeDocument) => Promise<WireframeDocument>
  addTask: (task: Record<string, unknown>) => unknown | Promise<unknown>
  snapshots: SnapshotStore
}

/** CAS-retried read-modify-write on the session journal. `mutate` returns
 *  false to abort without writing. Best-effort (3 attempts), the
 *  closeWireframeLifecycle discipline. */
async function mutateSession(
  options: Pick<ApplySessionOptions, 'getDesignSession' | 'setDesignSession'>,
  mutate: (doc: DesignSessionDocument) => boolean,
): Promise<DesignSessionDocument | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = await options.getDesignSession()
    if (!mutate(doc)) return doc
    doc.updatedAt = Date.now()
    try {
      return await options.setDesignSession(doc)
    } catch (err) {
      if (!(err instanceof RevConflictError)) throw err
    }
  }
  console.warn('[Annotask] design-session mutation gave up after rev conflicts')
  return null
}

function isPendingEntry(e: SessionEntry): boolean {
  return e.live.status === 'pending' || e.live.status === 'failed'
}

/** The agent-facing slice of an entry — envelope cruft (eids, collapse keys)
 *  stripped; the change payload + anchor + evidence are the contract. */
function entryForTask(e: SessionEntry): Record<string, unknown> {
  return {
    id: e.id,
    change: e.change,
    anchor: e.anchor,
    ...(e.evidence ? { evidence: e.evidence } : {}),
    ...(e.instanceId ? { instance_id: e.instanceId } : {}),
  }
}

export async function applyDesignSession(
  options: ApplySessionOptions,
  route: string,
  extras?: { screenshot?: string },
): Promise<{ taskId: string; batchId: string; entryIds: string[]; instanceIds: string[] } | { error: string }> {
  const session = await options.getDesignSession()
  const wireframe = await options.getWireframe()

  // Element edits are session-wide (files aren't route-owned); placements are
  // per-route, matching Build's contract. Wireframe directions are a per-route
  // sketch diff — only the applied route's directions ride this task.
  const entries = session.entries.filter((e) =>
    isPendingEntry(e) && !e.instanceId
    && (e.change.type !== 'wireframe_direction' || e.route === route))
  const instances = (wireframe.routes.find((r) => r.route === route)?.instances ?? [])
    .filter((i) => (i.status ?? 'placed') === 'placed')
  if (entries.length === 0 && instances.length === 0) return { error: 'nothing to apply' }
  const hasDirections = entries.some((e) => e.change.type === 'wireframe_direction')

  // Dominant anchor file → the task-level anchor (buildWireframeRoute precedent).
  const fileCounts = new Map<string, number>()
  for (const e of entries) fileCounts.set(e.anchor.file, (fileCounts.get(e.anchor.file) ?? 0) + 1)
  for (const i of instances) fileCounts.set(i.anchor.file, (fileCounts.get(i.anchor.file) ?? 0) + 1)
  let domFile = ''
  let domCount = -1
  for (const [f, c] of fileCounts) if (c > domCount) { domFile = f; domCount = c }
  const domLine = entries.find((e) => e.anchor.file === domFile)?.anchor.line
    ?? instances.find((i) => i.anchor.file === domFile)?.anchor.line ?? 0

  // Number ONLY the direction entries (1..N in journal order — the order the
  // shell recorded them, which is the composite's badge order). Instances and
  // legacy session edits ride unnumbered so the badge mapping can't drift.
  let directionNumber = 0
  const summaryLines = [
    ...instances.map((i) => `- place <${i.inserted.componentName ?? i.inserted.tag}> ${i.anchor.position} ${i.anchor.component || i.anchor.targetTag || 'target'}`),
    ...entries.map((e) => e.change.type === 'wireframe_direction'
      ? `${++directionNumber}. ${e.change.description}`
      : `- ${e.change.description}`),
  ]
  // Directions get the intent frame; the composite sentence only when a
  // composite actually rode along (the screenshot is best-effort by design).
  const compositeNote = extras?.screenshot
    ? " The task screenshot is a labeled before/after composite (left: captured render; right: the user's sketch — rearranged images, not real UI). Numbered badges on the right pane match the numbered directions below."
    : ''
  const description = hasDirections
    ? `Implement the wireframe sketch on ${route}.${compositeNote} Pixel positions are hints — implement the INTENT with idiomatic layout.\n${summaryLines.join('\n')}`
    : `Apply ${summaryLines.length} design-session edit${summaryLines.length === 1 ? '' : 's'} on ${route}:\n${summaryLines.join('\n')}`

  const task = await options.addTask({
    type: 'wireframe_apply',
    description,
    file: domFile,
    line: domLine,
    route,
    ...(extras?.screenshot ? { screenshot: extras.screenshot } : {}),
    context: {
      ...(instances.length > 0 ? { wireframe: { route, instances } } : {}),
      session: { session_id: session.sessionId, entries: entries.map(entryForTask) },
    },
  }) as { id?: string } | null
  if (!task?.id) return { error: 'task creation failed' }
  const taskId = task.id

  // Snapshot BEFORE the agent can run — the journal is the crash-safety net.
  const batchId = `ab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const files = [...new Set([...entries.map((e) => e.anchor.file), ...instances.map((i) => i.anchor.file)])]
  await options.snapshots.snapshotFiles(files, { id: batchId, taskId })

  // Stamp instances 'building' (the existing Build semantics: a second apply
  // won't collect them, and reapply won't re-mount them during review). A
  // directions apply also locks the route's canvas sketch to the task —
  // editing a sketch the agent is mid-implementing would lie about state.
  if (instances.length > 0 || hasDirections) {
    const ids = new Set(instances.map((i) => i.id))
    for (let attempt = 0; attempt < 3; attempt++) {
      const wf = await options.getWireframe()
      let touched = false
      const routes = wf.routes.map((r) => {
        if (r.route !== route) return r
        let routeTouched = false
        const next = r.instances.map((i) => {
          if (!ids.has(i.id)) return i
          routeTouched = true
          return { ...i, status: 'building' as const, taskId, updatedAt: Date.now() }
        })
        let canvas = r.canvas
        if (hasDirections && r.canvas && (r.canvas.status ?? 'sketch') === 'sketch') {
          routeTouched = true
          canvas = { ...r.canvas, status: 'building' as const, taskId }
        }
        if (!routeTouched) return r
        touched = true
        return { ...r, instances: next, canvas, updatedAt: Date.now() }
      })
      if (!touched) break
      try {
        await options.setWireframe({ ...wf, routes, updatedAt: Date.now() })
        break
      } catch (err) {
        if (!(err instanceof WireframeRevConflictError)) {
          console.warn('[Annotask] apply: stamping instances building failed:', err)
          break
        }
      }
    }
  }

  // Stamp entries 'applying' against the batch + task.
  const entryIds = new Set(entries.map((e) => e.id))
  await mutateSession(options, (doc) => {
    let touched = false
    for (const e of doc.entries) {
      if (!entryIds.has(e.id) || !isPendingEntry(e)) continue
      e.live = { status: 'applying', applyBatchId: batchId }
      e.taskId = taskId
      touched = true
    }
    return touched
  })

  return { taskId, batchId, entryIds: [...entryIds], instanceIds: instances.map((i) => i.id) }
}

/** Does the file's current content plausibly contain the applied edit? Used as
 *  the verification fallback when the exact anchor drifted (the agent's own
 *  edits shift lines). Conservative string checks — a miss marks the entry
 *  'failed', never silently 'written'. */
function contentContainsEdit(content: string, e: SessionEntry): boolean {
  const c = e.change as unknown as Record<string, unknown>
  if (c.type === 'text_update') {
    const after = String(c.after ?? '').trim()
    return after.length > 0 && content.includes(after)
  }
  if (c.type === 'component_prop_update') {
    const after = c.after
    if (after === undefined || after === null) return false
    const v = typeof after === 'string' ? after : JSON.stringify(after)
    return v.length > 0 && content.includes(v)
  }
  if (c.type === 'style_update') {
    return typeof c.after === 'string' && c.after.length > 0 && content.includes(c.after)
  }
  if (c.type === 'class_update') {
    const after = (c.after as { classes?: string } | undefined)?.classes ?? ''
    return after.length > 0 && content.includes(after)
  }
  // Moves/annotations/inserts: trust the agent's review state — there is no
  // cheap literal to look for.
  return true
}

/**
 * Verification pass — runs when the apply task transitions to 'review'.
 * Precision over recall: an entry only flips to 'written' when its literal is
 * verifiably in source (exact-anchor classification first, conservative
 * content check as the drift fallback); everything else flips to 'failed'
 * with a reason the panel can show.
 */
export async function verifyAppliedEntries(
  options: ApplySessionOptions,
  taskId: string,
): Promise<void> {
  const session = await options.getDesignSession()
  const toVerify = session.entries.filter((e) => e.taskId === taskId && e.live.status === 'applying')

  const verdicts = new Map<string, { ok: boolean; error?: string }>()
  for (const e of toVerify) {
    const c = e.change as unknown as Record<string, unknown>
    // Spatial outcomes aren't literally verifiable in source — a direction
    // flips on task review (trust the agent's resolution; the user verifies
    // visually). Decided BEFORE any file read: the agent may legitimately
    // have renamed/split the anchor file while implementing the sketch.
    if (c.type === 'wireframe_direction') {
      verdicts.set(e.id, { ok: true })
      continue
    }
    let ok = false
    try {
      if (c.type === 'component_prop_update' || c.type === 'text_update') {
        // Exact anchor first — proves the edit landed where it was recorded.
        const cls = await classifyBindings(options.projectRoot, e.anchor.file, e.anchor.line, { tag: e.anchor.targetTag })
        if (!cls.error) {
          if (c.type === 'text_update') {
            ok = cls.text.kind === 'literal' && (cls.text.source ?? '').trim() === String(c.after ?? '').trim()
          } else {
            const field = cls.props.find((p) => p.name === c.prop)
            const after = c.after
            const want = typeof after === 'string' ? after : String(after)
            ok = !!field && field.kind === 'literal' && field.source.replace(/^['"`]|['"`]$/g, '') === want
          }
        }
      }
      if (!ok) {
        // Drift fallback: the agent's other edits moved the anchor — verify by
        // content. resolveProjectFile keeps the read inside the project.
        const resolved = resolveProjectFile(options.projectRoot, e.anchor.file)
        const abs = resolved?.absolutePath ?? (path.isAbsolute(e.anchor.file) ? e.anchor.file : null)
        if (abs) {
          const content = await fsp.readFile(abs, 'utf-8')
          ok = contentContainsEdit(content, e)
        }
      }
      verdicts.set(e.id, ok ? { ok } : { ok, error: 'agent run finished but this edit was not found in source — see the task' })
    } catch (err) {
      verdicts.set(e.id, { ok: false, error: `verification failed: ${(err as Error).message}` })
    }
  }

  if (toVerify.length > 0) {
    await mutateSession(options, (doc) => {
      let touched = false
      for (const e of doc.entries) {
        const verdict = verdicts.get(e.id)
        if (!verdict || e.live.status !== 'applying') continue
        e.live = verdict.ok
          ? { status: 'written', applyBatchId: e.live.applyBatchId, writtenAt: Date.now() }
          : { status: 'failed', applyBatchId: e.live.applyBatchId, error: verdict.error }
        touched = true
      }
      return touched
    })
  }

  // (Re-)seal post-apply hashes — the baseline the undo/discard hash-guard
  // trusts. Sealed by TASK, unconditionally on every review: re-apply after a
  // deny leaves no entry in 'applying' (they're already written/failed) yet the
  // agent wrote NEW bytes that must become the new undo baseline; and a
  // pure-instances apply has no session entries to verify but still needs its
  // hash. Re-sealing is safe — only lastAppliedHash + the created net change.
  await options.snapshots.sealBatchByTask(taskId)
}

/** Undo the newest apply batch: restore its pre-apply bytes and return its
 *  entries to 'pending' so they re-surface as work. */
export async function revertApplyBatch(
  options: ApplySessionOptions,
  batchId: string,
): Promise<{ reverted: string[]; skipped: string[] }> {
  const result = await options.snapshots.revertBatch(batchId)
  await mutateSession(options, (doc) => {
    let touched = false
    for (const e of doc.entries) {
      if (e.live.applyBatchId !== batchId) continue
      e.live = { status: 'pending' }
      delete e.taskId
      touched = true
    }
    return touched
  })
  return result
}

/**
 * Accept: the user reviewed the agent's work and kept it. The bytes are now
 * the project's baseline — drop the snapshot journal (no more undo into the
 * accepted state), remove the task's session entries, and when that empties
 * the journal, hand back `rotated: true` so the caller mints a fresh session.
 */
export async function acceptApplyTask(
  options: Pick<ApplySessionOptions, 'getDesignSession' | 'setDesignSession' | 'snapshots'>,
  taskId: string,
): Promise<{ rotated: boolean }> {
  await options.snapshots.commit()
  const doc = await mutateSession(options, (d) => {
    const before = d.entries.length
    d.entries = d.entries.filter((e) => e.taskId !== taskId)
    return d.entries.length !== before
  })
  return { rotated: !!doc && doc.entries.length === 0 }
}

/** Abandoned run (task deleted, or a crashed/aborted seed run flipped the task
 *  back to pending/blocked without ever reaching review): seal the
 *  possibly-half-written batch as 'failed' so it carries a hash baseline and
 *  stays revertible (the undo/discard guard refuses a still-'running' batch),
 *  then return its entries to 'pending' so they re-surface as work. */
export async function releaseApplyTask(
  options: Pick<ApplySessionOptions, 'getDesignSession' | 'setDesignSession' | 'snapshots'>,
  taskId: string,
): Promise<void> {
  await options.snapshots.sealBatchByTask(taskId, { failed: true })
  await mutateSession(options, (doc) => {
    let touched = false
    for (const e of doc.entries) {
      if (e.taskId !== taskId) continue
      if (e.live.status === 'applying') e.live = { status: 'pending', applyBatchId: e.live.applyBatchId }
      delete e.taskId
      touched = true
    }
    return touched
  })
}
