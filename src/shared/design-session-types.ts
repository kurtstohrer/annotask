/**
 * Design-session document — the persisted, ordered journal of what the user
 * did in a design session. One `.annotask/design-session.json` per project,
 * shared by the server GET/PUT validator, the shell `useDesignSession`
 * composable, and the agent-facing `wireframe_apply` task context
 * (`context.session`) — so the persisted shape, the shell, and the apply
 * playbook never drift. Mirrors the wireframe-types.ts discipline: runtime
 * shape guards validate to entry depth at the HTTP boundary.
 *
 * The journal is the truth of "what the user did", in order. Placement
 * entries cross-reference their `WireframeInstance` by id (wireframe.json
 * stays the canonical placement artifact — payloads are never copied).
 * Element edits carry the `AnnotaskChange` payload plus anchor + classifier
 * evidence. Source writes are always agent-authored; the `live` state tracks
 * whether an entry is still pending, riding an apply batch, verified written
 * in source, or failed verification.
 */

import type { AnnotaskChange } from '../schema'

/**
 * Where an entry is in the agent-apply lifecycle.
 *  'pending'  — recorded (and optimistically previewed where honest); not in source.
 *  'applying' — part of an in-flight apply batch (agent running).
 *  'written'  — verified present in source after an apply batch sealed.
 *  'failed'   — apply batch finished but verification couldn't find the edit.
 */
export type LiveWriteStatus = 'pending' | 'applying' | 'written' | 'failed'

export interface LiveWriteState {
  status: LiveWriteStatus
  /** The apply batch that wrote (or tried to write) this entry. */
  applyBatchId?: string
  /** Human-readable failure reason when status === 'failed'. */
  error?: string
  writtenAt?: number
}

/**
 * Round-trip-honesty evidence captured at record time by the binding
 * classifier. The agent re-grounds at apply time (code-context /
 * binding-classify); this is the record of what the shell verified before
 * allowing the edit.
 */
export interface EditEvidence {
  classification: 'literal' | 'bound' | 'loop-literal' | 'unknown'
  /** sha256-16 of the excerpt around the anchor at classify time — drift guard. */
  excerptHash?: string
  /** The bound expression when read-only (e.g. 'planet.name'). */
  binding?: string
  /** When loop-rendered: how many instances the edit visibly affects. */
  loopCount?: number
}

/** Durable element anchor, from data-annotask-file/-line (+ re-resolution aids). */
export interface SessionAnchor {
  file: string
  line: number
  /** Re-resolution aid for findTemplateGroup after reload/HMR. */
  targetTag?: string
  component?: string
  /** Inserts/moves only. */
  position?: 'before' | 'after' | 'append' | 'prepend'
  mfe?: string
}

export interface SessionEntry {
  id: string
  /** Monotonic within the session — the undo order. */
  ordinal: number
  ts: number
  /** Normalized iframe route at record time. */
  route: string
  /** The change payload — the ONLY part report/task consumers see. */
  change: AnnotaskChange
  anchor: SessionAnchor
  evidence?: EditEvidence
  live: LiveWriteState
  /** Cross-reference to a WireframeInstance for placement entries. */
  instanceId?: string
  /** Volatile bridge element id — never trusted across HMR; re-resolved by anchor. */
  eid?: string
  /** Set when the entry was snapshotted into a wireframe_apply task. */
  taskId?: string
  /** Viewport preset scope for the edit (M6); null/absent = base. Ships now so
   *  collapse keys are breakpoint-aware from day one. */
  breakpointId?: string | null
}

export interface DesignSessionDocument {
  version: '1.0'
  sessionId: string
  startedAt: number
  updatedAt: number
  /** Server-managed write revision — same CAS scheme as wireframe.json. */
  rev?: number
  entries: SessionEntry[]
}

/**
 * How much of an apply's footprint "Undo last apply" can actually restore.
 *  'full'         — a git baseline was captured, so the seal auto-extends to
 *                   the agent's whole footprint.
 *  'anchors-only' — no git baseline; only the predicted anchor files restore.
 *  'none'         — no baseline AND an empty snapshot set: undo would
 *                   "succeed" restoring zero bytes.
 */
export type UndoCoverage = 'full' | 'anchors-only' | 'none'

/** One agent-apply run: which task it rode and which files it touched. */
export interface ApplyBatch {
  id: string
  taskId: string
  files: string[]
  startedAt: number
  finishedAt?: number
  status: 'running' | 'done' | 'failed'
  /** Undo-coverage honesty, stamped at snapshot time. Absent on batches that
   *  predate the field — consumers show nothing rather than guess. */
  coverage?: UndoCoverage
}

export const DESIGN_SESSION_DOC_VERSION = '1.0' as const

const LIVE_WRITE_STATUSES: readonly string[] = ['pending', 'applying', 'written', 'failed']
const EVIDENCE_CLASSIFICATIONS: readonly string[] = ['literal', 'bound', 'loop-literal', 'unknown']
const ANCHOR_POSITIONS: readonly string[] = ['before', 'after', 'append', 'prepend']

export function emptyDesignSessionDocument(sessionId: string): DesignSessionDocument {
  return { version: DESIGN_SESSION_DOC_VERSION, sessionId, startedAt: 0, updatedAt: 0, entries: [] }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isLiveWriteState(value: unknown): value is LiveWriteState {
  if (!isPlainObject(value)) return false
  if (!LIVE_WRITE_STATUSES.includes(value.status as string)) return false
  if (value.applyBatchId !== undefined && typeof value.applyBatchId !== 'string') return false
  if (value.error !== undefined && typeof value.error !== 'string') return false
  if (value.writtenAt !== undefined && typeof value.writtenAt !== 'number') return false
  return true
}

function isEditEvidence(value: unknown): value is EditEvidence {
  if (!isPlainObject(value)) return false
  if (!EVIDENCE_CLASSIFICATIONS.includes(value.classification as string)) return false
  if (value.excerptHash !== undefined && typeof value.excerptHash !== 'string') return false
  if (value.binding !== undefined && typeof value.binding !== 'string') return false
  if (value.loopCount !== undefined && typeof value.loopCount !== 'number') return false
  return true
}

function isSessionAnchor(value: unknown): value is SessionAnchor {
  if (!isPlainObject(value)) return false
  if (typeof value.file !== 'string') return false
  if (typeof value.line !== 'number') return false
  if (value.targetTag !== undefined && typeof value.targetTag !== 'string') return false
  if (value.component !== undefined && typeof value.component !== 'string') return false
  if (value.position !== undefined && !ANCHOR_POSITIONS.includes(value.position as string)) return false
  if (value.mfe !== undefined && typeof value.mfe !== 'string') return false
  return true
}

/** Entry-depth shape guard. The PUT boundary must reject a single malformed
 *  entry — once persisted it would poison reapply, undo ordering, and the
 *  agent's `context.session` payload. */
export function isSessionEntry(value: unknown): value is SessionEntry {
  if (!isPlainObject(value)) return false
  if (typeof value.id !== 'string' || !value.id) return false
  if (typeof value.ordinal !== 'number') return false
  if (typeof value.ts !== 'number') return false
  if (typeof value.route !== 'string') return false
  // The change payload is the open AnnotaskChange union — validate the shared
  // envelope only (id/type/description discipline lives with the producers).
  if (!isPlainObject(value.change) || typeof (value.change as Record<string, unknown>).type !== 'string') return false
  if (!isSessionAnchor(value.anchor)) return false
  if (value.evidence !== undefined && !isEditEvidence(value.evidence)) return false
  if (!isLiveWriteState(value.live)) return false
  if (value.instanceId !== undefined && typeof value.instanceId !== 'string') return false
  if (value.eid !== undefined && typeof value.eid !== 'string') return false
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return false
  if (value.breakpointId !== undefined && value.breakpointId !== null && typeof value.breakpointId !== 'string') return false
  return true
}

/** Structural validation for the GET/PUT boundary — entry depth, one bad entry
 *  rejects the whole document (the wireframe PUT discipline). */
export function isDesignSessionDocument(value: unknown): value is DesignSessionDocument {
  if (!isPlainObject(value)) return false
  if (value.version !== DESIGN_SESSION_DOC_VERSION) return false
  if (typeof value.sessionId !== 'string' || !value.sessionId) return false
  if (typeof value.startedAt !== 'number') return false
  if (typeof value.updatedAt !== 'number') return false
  if (value.rev !== undefined && typeof value.rev !== 'number') return false
  if (!Array.isArray(value.entries)) return false
  return (value.entries as unknown[]).every(isSessionEntry)
}
