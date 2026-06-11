import { ref, computed } from 'vue'
import { on as wsOn } from '../services/wsClient'
import type { DesignSessionDocument, SessionAnchor, EditEvidence, LiveWriteState, ApplyBatch } from '../../shared/design-session-types'
// Type-only import — runtime dependency points the other way (useStyleEditor
// records into this journal), so this cycle is erased at compile time.
import type { ChangeRecord } from './useStyleEditor'

/**
 * Shell-side session entry. Mirrors the persisted `SessionEntry`
 * (shared/design-session-types.ts) but carries the legacy `ChangeRecord`
 * runtime payload — the report/task shapes are projected from it by
 * useStyleEditor.shapeChange, exactly as before. Serialization to the server
 * document (and the agent-facing `context.session`) strips the non-schema
 * fields at that boundary.
 */
export interface ShellSessionEntry {
  id: string
  /** Monotonic within the session — the undo order. */
  ordinal: number
  ts: number
  /** Normalized iframe route at record time. */
  route: string
  change: ChangeRecord
  anchor: SessionAnchor
  evidence?: EditEvidence
  live: LiveWriteState
  /** Cross-reference to a WireframeInstance for placement entries. The
   *  instance payload is never copied — wireframe.json stays canonical. */
  instanceId?: string
  /** Volatile bridge element id — never trusted across HMR. */
  eid?: string
  /** Set when the entry was snapshotted into a wireframe_apply task. */
  taskId?: string
  breakpointId?: string | null
  /** Collapse identity (includes eid) — entries sharing it project to ONE
   *  report record and amend during a continuous gesture. Absent = never grouped. */
  amendKey?: string
  /** Gesture identity (amendKey minus eid). Lets a group-selection slider drag
   *  (N eids per tick) amend its N entries instead of appending N per tick. */
  gestureKey?: string
}

export interface RecordEntryInput {
  change: ChangeRecord
  anchor: SessionAnchor
  route?: string
  eid?: string
  instanceId?: string
  evidence?: EditEvidence
  amendKey?: string
  gestureKey?: string
  /** Applied to the latest pending same-key entry instead of appending, when
   *  the entries recorded since it all belong to the same gesture. Must update
   *  `after`/description only — `before` is preserved from first touch. */
  amendTop?: (top: ChangeRecord) => void
}

/** The iframe surface the reload-restore preview pass needs — structural so
 *  tests can pass a small mock; useIframeManager satisfies it. */
export interface SessionPreviewIframe {
  findTemplateGroup: (file: string, line: string, tagName: string) => Promise<{ eids: string[] }>
  applyStyleVia?: (eid: string, property: string, value: string) => Promise<string>
  setClass?: (eid: string, classes: string) => Promise<string>
}

// Module-level singleton state — same pattern as useStyleEditor's change
// buffer and useWireframeDoc: every caller shares one session.
const entries = ref<ShellSessionEntry[]>([])
const redoBuffer: ShellSessionEntry[] = []
/** Normalized iframe route, wired from useIframeManager by App.vue. */
const sessionRoute = ref('')
/** Active viewport scope for new entries (M6); null = base viewport. Included
 *  in collapse keys from day one so retrofitting can't corrupt undo grouping. */
const activeBreakpointId = ref<string | null>(null)
/** Last sync problem worth surfacing ('session active in another tab', …). */
const syncError = ref<string | null>(null)
/** Set when a second 409 in a row proves another tab owns the session. */
const readOnly = ref(false)
/** Entries whose anchors no longer resolve in the live DOM after a reload —
 *  the preview can't honestly claim them, so they get a badge instead. */
const staleEntryIds = ref<string[]>([])
/** Snapshot-engine state (touched files + apply batches) for the panel. */
const snapshotState = ref<{ files: Record<string, { baseHash: string; lastAppliedHash?: string; status: 'clean' | 'diverged' }>; batches: ApplyBatch[] }>({ files: {}, batches: [] })
/** An apply POST is in flight or its agent run hasn't settled yet. */
const applying = ref(false)
/** Loud-failure surface for apply/undo/discard operations. */
const lastError = ref<string | null>(null)

let ordinalCounter = 0
let entryCounter = 0
let sessionId = ''
let startedAt = 0
let lastRev: number | undefined
let initialized = false
// Reload-restore de-dup: which route's previews were replayed into the
// current iframe document (reset when bridgeReady refires).
let previewAppliedRoute: string | null = null

// ── Persistence: debounced single-flight CAS PUT ──
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false
let dirty = false

function setStale(id: string, present: boolean): void {
  const has = staleEntryIds.value.includes(id)
  if (present && !has) staleEntryIds.value = [...staleEntryIds.value, id]
  else if (!present && has) staleEntryIds.value = staleEntryIds.value.filter((x) => x !== id)
}

function ensureSessionIdentity(): void {
  if (!sessionId) {
    sessionId = `ds-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    startedAt = Date.now()
  }
}

function serializeEntry(e: ShellSessionEntry): Record<string, unknown> {
  // placeholderEl (a DOM node) must never reach JSON.stringify; everything
  // else on the records is plain data.
  const { placeholderEl: _el, ...change } = e.change as ChangeRecord & { placeholderEl?: Element }
  return { ...e, change }
}

function buildDoc(): Record<string, unknown> {
  ensureSessionIdentity()
  return {
    version: '1.0',
    sessionId,
    startedAt,
    updatedAt: Date.now(),
    ...(lastRev !== undefined ? { rev: lastRev } : {}),
    entries: entries.value.map(serializeEntry),
  }
}

function reseedCounters(): void {
  ordinalCounter = entries.value.reduce((m, e) => Math.max(m, e.ordinal), 0)
  entryCounter = entries.value.reduce((m, e) => {
    const n = /^se-(\d+)$/.exec(e.id)
    return n ? Math.max(m, parseInt(n[1], 10)) : m
  }, 0)
}

function adoptDocument(doc: DesignSessionDocument): void {
  entries.value = doc.entries as unknown as ShellSessionEntry[]
  sessionId = doc.sessionId
  startedAt = doc.startedAt
  lastRev = doc.rev
  redoBuffer.length = 0
  reseedCounters()
}

/** Server wins `live`/`taskId` per entry id; the local list wins on entry
 *  presence and change payloads (the two sides mutate disjoint fields). Other
 *  tabs' new entries are appended in ordinal order. */
function mergeFromServer(server: DesignSessionDocument): void {
  const serverById = new Map(server.entries.map((e) => [e.id, e]))
  for (const local of entries.value) {
    const remote = serverById.get(local.id)
    if (remote) {
      local.live = remote.live as LiveWriteState
      if (remote.taskId !== undefined) local.taskId = remote.taskId
    }
  }
  const localIds = new Set(entries.value.map((e) => e.id))
  const foreign = server.entries.filter((e) => !localIds.has(e.id)) as unknown as ShellSessionEntry[]
  if (foreign.length > 0) {
    entries.value = [...entries.value, ...foreign].sort((a, b) => a.ordinal - b.ordinal)
  }
  sessionId = server.sessionId
  startedAt = server.startedAt
  lastRev = server.rev
  reseedCounters()
}

async function flushNow(): Promise<void> {
  if (flushing) { dirty = true; return }
  if (readOnly.value) return
  flushing = true
  dirty = false
  try {
    const res = await fetch('/__annotask/api/design-session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildDoc()),
    })
    if (res.status === 409) {
      // Another writer (tab, or a server lifecycle hook) committed first.
      // Merge their truth in, then retry exactly once — a second conflict
      // means a genuinely concurrent editor, so go read-only instead of
      // ping-ponging writes.
      const server = (await (await fetch('/__annotask/api/design-session')).json()) as unknown
      if (!looksLikeSessionDoc(server)) throw new Error('unexpected design-session payload')
      mergeFromServer(server)
      const retry = await fetch('/__annotask/api/design-session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildDoc()),
      })
      if (retry.status === 409) {
        readOnly.value = true
        syncError.value = 'Design session is active in another tab — this tab is read-only.'
        return
      }
      if (!retry.ok) throw new Error(`HTTP ${retry.status}`)
      const saved = (await retry.json()) as DesignSessionDocument
      lastRev = saved.rev
      syncError.value = null
      return
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const saved = (await res.json()) as DesignSessionDocument
    lastRev = saved.rev
    syncError.value = null
  } catch (err) {
    syncError.value = (err as Error).message ?? 'Failed to save design session'
  } finally {
    flushing = false
    if (dirty) queueFlush()
  }
}

function queueFlush(): void {
  dirty = true
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => { flushTimer = null; void flushNow() }, 300)
}

function looksLikeSessionDoc(v: unknown): v is DesignSessionDocument {
  return !!v && typeof v === 'object'
    && typeof (v as DesignSessionDocument).sessionId === 'string'
    && Array.isArray((v as DesignSessionDocument).entries)
}

async function load(): Promise<void> {
  try {
    const res = await fetch('/__annotask/api/design-session')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const doc = (await res.json()) as unknown
    // Never clobber the in-memory journal with something that isn't a session
    // document (misrouted proxy, stale server build).
    if (!looksLikeSessionDoc(doc)) throw new Error('unexpected design-session payload')
    adoptDocument(doc)
    syncError.value = null
  } catch (err) {
    syncError.value = (err as Error).message ?? 'Failed to load design session'
  }
}

function findAmendTarget(amendKey: string, gestureKey: string | undefined): ShellSessionEntry | null {
  for (let i = entries.value.length - 1; i >= 0; i--) {
    const e = entries.value[i]
    if (e.amendKey === amendKey) {
      // Amendable only while untouched by apply/snapshot.
      if (e.live.status !== 'pending' || e.taskId) return null
      return e
    }
    // An intervening entry from a DIFFERENT gesture breaks the run — the
    // re-edit is a new user action and must append (ordered undo).
    if (!gestureKey || e.gestureKey !== gestureKey) return null
  }
  return null
}

export function useDesignSession() {
  if (!initialized) {
    initialized = true
    void load()
    void refreshSnapshots()
    wsOn('session:updated', (payload: unknown) => {
      const doc = payload as DesignSessionDocument | null
      // The snapshot view (touched files, batches, divergence) can change on
      // any server-side session mutation — keep the panel fresh.
      void refreshSnapshots()
      // Our own PUT echoes back with the rev we just adopted — ignore it.
      if (doc && typeof doc.rev === 'number' && doc.rev === lastRev) return
      // Unflushed local work: let the flush's 409-merge reconcile instead of
      // clobbering the in-memory journal with a lagging disk state.
      if (dirty || flushing) return
      if (looksLikeSessionDoc(doc)) {
        adoptDocument(doc)
      } else {
        void load()
      }
    })
  }

  /** Append a new entry, or amend the latest same-key entry recorded within
   *  the current gesture run. Returns the live entry either way. */
  function record(input: RecordEntryInput): ShellSessionEntry {
    redoBuffer.length = 0
    ensureSessionIdentity()
    if (input.amendKey && input.amendTop) {
      const target = findAmendTarget(input.amendKey, input.gestureKey)
      if (target) {
        input.amendTop(target.change)
        target.ts = Date.now()
        if (input.eid) target.eid = input.eid
        if (input.evidence) target.evidence = input.evidence
        queueFlush()
        return target
      }
    }
    entryCounter++
    const entry: ShellSessionEntry = {
      id: `se-${entryCounter}`,
      ordinal: ++ordinalCounter,
      ts: Date.now(),
      route: input.route ?? sessionRoute.value,
      change: input.change,
      anchor: input.anchor,
      ...(input.evidence ? { evidence: input.evidence } : {}),
      live: { status: 'pending' },
      ...(input.instanceId ? { instanceId: input.instanceId } : {}),
      ...(input.eid ? { eid: input.eid } : {}),
      breakpointId: activeBreakpointId.value,
      ...(input.amendKey ? { amendKey: input.amendKey } : {}),
      ...(input.gestureKey ? { gestureKey: input.gestureKey } : {}),
    }
    entries.value.push(entry)
    queueFlush()
    return entry
  }

  /** Pop the journal tail into the redo buffer — the session-wide undo unit.
   *  Written/applying entries are NOT poppable here: agent-authored source
   *  can't be un-written per entry (the tool didn't author it) — the panel's
   *  "Undo last apply" restores that batch's snapshots instead. */
  function popForUndo(): ShellSessionEntry | null {
    const last = entries.value[entries.value.length - 1]
    if (!last) return null
    if (last.live.status === 'written' || last.live.status === 'applying') return null
    entries.value.pop()
    redoBuffer.push(last)
    setStale(last.id, false)
    queueFlush()
    return last
  }

  function setLiveState(entryId: string, live: LiveWriteState): void {
    const e = entries.value.find((x) => x.id === entryId)
    if (!e) return
    e.live = live
    queueFlush()
  }

  function findByChangeId(changeId: string): ShellSessionEntry | undefined {
    return entries.value.find((e) => e.change.id === changeId)
  }

  /** Remove entries matching the predicate; returns the removed entries. */
  function removeWhere(pred: (e: ShellSessionEntry) => boolean): ShellSessionEntry[] {
    const removed: ShellSessionEntry[] = []
    entries.value = entries.value.filter((e) => {
      if (pred(e)) { removed.push(e); return false }
      return true
    })
    if (removed.length > 0) {
      for (const e of removed) setStale(e.id, false)
      queueFlush()
    }
    return removed
  }

  function removeByInstanceId(instanceId: string): ShellSessionEntry[] {
    return removeWhere((e) => e.instanceId === instanceId)
  }

  /** Clear the whole journal; returns the removed entries. */
  function clear(): ShellSessionEntry[] {
    const removed = entries.value
    entries.value = []
    redoBuffer.length = 0
    staleEntryIds.value = []
    if (removed.length > 0) queueFlush()
    return removed
  }

  /**
   * Reload-restore: replay this route's pending style/class previews onto the
   * fresh iframe DOM, so a persisted session never claims edits the preview
   * doesn't show. Anchors re-resolve via the durable (file, line, targetTag)
   * triple; an anchor that resolves to MULTIPLE elements (a loop) is marked
   * stale instead of replayed — applying one element's edit to all N would
   * silently fake what the user did. Precision over recall.
   */
  async function reapplyPreviews(route: string, iframe: SessionPreviewIframe, opts?: { force?: boolean }): Promise<void> {
    if (!opts?.force && route === previewAppliedRoute) return
    previewAppliedRoute = route
    const candidates = entries.value.filter(
      (e) => !e.instanceId
        && e.route === route
        && (e.live.status === 'pending' || e.live.status === 'failed')
        && (e.change.type === 'style_update' || e.change.type === 'class_update'),
    )
    for (const e of candidates) {
      try {
        const group = await iframe.findTemplateGroup(e.anchor.file, String(e.anchor.line), e.anchor.targetTag ?? '')
        if (group.eids.length !== 1) {
          setStale(e.id, true)
          continue
        }
        const eid = group.eids[0]
        if (e.change.type === 'style_update' && iframe.applyStyleVia) {
          await iframe.applyStyleVia(eid, e.change.property, e.change.after)
        } else if (e.change.type === 'class_update' && iframe.setClass) {
          await iframe.setClass(eid, e.change.after.classes)
        }
        // Re-stamp the volatile eid so undo targets the live node again.
        e.eid = eid
        setStale(e.id, false)
      } catch {
        setStale(e.id, true)
      }
    }
  }

  /** Drop the preview-replay de-dup (a fresh iframe DOM means nothing is applied). */
  function resetPreviewApplied(): void {
    previewAppliedRoute = null
  }

  /** Test hook + pre-snapshot barrier: run the debounced flush immediately. */
  async function queueFlushNow(): Promise<void> {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    await flushNow()
  }

  async function refreshSnapshots(): Promise<void> {
    try {
      const res = await fetch('/__annotask/api/design-session/snapshots')
      if (!res.ok) return
      const state = (await res.json()) as typeof snapshotState.value
      if (state && state.files && Array.isArray(state.batches)) snapshotState.value = state
    } catch { /* panel state is best-effort */ }
  }

  /**
   * "Apply now": flush the journal, then ask the server to snapshot the
   * touched files and mint ONE wireframe_apply task (placements + panel
   * edits). The caller hands the returned taskId to the embedded-agent
   * auto-run (or leaves it for an external agent).
   */
  async function applyNow(): Promise<{ taskId: string; batchId: string } | null> {
    lastError.value = null
    applying.value = true
    try {
      await queueFlushNow()
      const res = await fetch('/__annotask/api/design-session/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: sessionRoute.value || '/' }),
      })
      const body = await res.json().catch(() => null) as { taskId?: string; batchId?: string; error?: { message?: string } } | null
      if (!res.ok || !body?.taskId || !body?.batchId) {
        lastError.value = body?.error?.message ?? `apply failed (HTTP ${res.status})`
        return null
      }
      await load()
      await refreshSnapshots()
      return { taskId: body.taskId, batchId: body.batchId }
    } catch (err) {
      lastError.value = (err as Error).message ?? 'apply failed'
      return null
    } finally {
      applying.value = false
    }
  }

  /** Restore the newest apply batch's pre-apply bytes; its entries return to pending. */
  async function undoLastBatch(): Promise<{ reverted: string[]; skipped: string[] } | null> {
    const batch = snapshotState.value.batches[snapshotState.value.batches.length - 1]
    if (!batch) return null
    lastError.value = null
    try {
      const res = await fetch('/__annotask/api/design-session/undo-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: batch.id }),
      })
      const body = await res.json().catch(() => null) as { reverted?: string[]; skipped?: string[]; error?: { message?: string } } | null
      if (!res.ok) {
        lastError.value = body?.error?.message ?? `undo failed (HTTP ${res.status})`
        return null
      }
      await load()
      await refreshSnapshots()
      if (body?.skipped?.length) {
        lastError.value = `Could not restore ${body.skipped.join(', ')} — edited outside Annotask (detach to keep the current bytes)`
      }
      return { reverted: body?.reverted ?? [], skipped: body?.skipped ?? [] }
    } catch (err) {
      lastError.value = (err as Error).message ?? 'undo failed'
      return null
    }
  }

  /** Discard the whole session: server restores every snapshot-tracked file to
   *  its session base and removes the session's placements. */
  async function discardSession(): Promise<{ revertedFiles: string[]; failedFiles: string[]; removedInstances: number } | null> {
    lastError.value = null
    try {
      const res = await fetch('/__annotask/api/design-session', { method: 'DELETE' })
      const body = await res.json().catch(() => null) as { revertedFiles?: string[]; failedFiles?: string[]; removedInstances?: number } | null
      if (!res.ok) {
        lastError.value = `discard failed (HTTP ${res.status})`
        return null
      }
      clear()
      await load()
      await refreshSnapshots()
      if (body?.failedFiles?.length) {
        lastError.value = `Could not restore ${body.failedFiles.join(', ')} — edited outside Annotask`
      }
      return { revertedFiles: body?.revertedFiles ?? [], failedFiles: body?.failedFiles ?? [], removedInstances: body?.removedInstances ?? 0 }
    } catch (err) {
      lastError.value = (err as Error).message ?? 'discard failed'
      return null
    }
  }

  /** Diverged-file resolution: keep the disk bytes, forget the file. */
  async function detachFile(file: string): Promise<void> {
    try {
      const res = await fetch('/__annotask/api/design-session/detach-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file }),
      })
      if (res.ok) {
        const state = (await res.json()) as typeof snapshotState.value
        if (state && state.files) snapshotState.value = state
      }
    } catch { /* best effort */ }
  }

  return {
    entries,
    sessionRoute,
    activeBreakpointId,
    syncError,
    readOnly,
    staleEntryIds,
    snapshotState,
    applying,
    lastError,
    record,
    popForUndo,
    setLiveState,
    findByChangeId,
    removeWhere,
    removeByInstanceId,
    clear,
    load,
    reapplyPreviews,
    resetPreviewApplied,
    queueFlushNow,
    refreshSnapshots,
    applyNow,
    undoLastBatch,
    discardSession,
    detachFile,
  }
}
