import { computed, watch } from 'vue'
import type { CatalogItem } from '../types'
import type { AnnotaskReport, WireframeDirectionChange } from '../../schema'
import { useDesignSpec } from './useDesignSpec'
import { useViewportPreview } from './useViewportPreview'
import { useInteractionHistory } from './useInteractionHistory'
import { send as wsSend } from '../services/wsClient'
import { useDesignSession, type ShellSessionEntry } from './useDesignSession'

export interface StyleChangeRecord {
  id: string
  type: 'style_update'
  description: string
  file: string
  section: 'template' | 'style'
  line: number
  component: string
  mfe?: string
  element: string
  property: string
  before: string
  after: string
  /** Design token semantic role (e.g. 'primary'). Set when the value was picked from a design token. */
  tokenRole?: string
}

export interface InsertChangeRecord {
  id: string
  type: 'component_insert'
  description: string
  file: string
  section: 'template'
  line: number
  component?: string
  mfe?: string
  insert_inside?: { component?: string; element?: string }
  insert_position: 'before' | 'after' | 'append' | 'prepend'
  inserted: {
    tag: string
    library?: string
    props?: Record<string, unknown>
    classes?: string
    text_content?: string
  }
  placeholderEl?: Element
}

export interface MoveChangeRecord {
  id: string
  type: 'component_move'
  description: string
  file: string
  section: 'template'
  line: number
  component?: string
  mfe?: string
  element_tag: string
  from_file: string
  from_line: number
  move_to: {
    target_file: string
    target_line: number
    position: 'before' | 'after' | 'append' | 'prepend'
  }
}

export interface AnnotationChangeRecord {
  id: string
  type: 'annotation'
  description: string
  file: string
  section: 'template'
  line: number
  component: string
  mfe?: string
  intent: string
  action?: string
  context?: {
    element_tag?: string
    element_classes?: string
    parent_layout?: string
    siblings_count?: number
  }
  pinId?: string
}

export interface ClassChangeRecord {
  id: string
  type: 'class_update'
  description: string
  file: string
  section: 'template'
  line: number
  component: string
  mfe?: string
  element: string
  before: { classes: string }
  after: { classes: string }
}

// WireframeDirectionChange rides the same journal (the apply loop's transport)
// but is invisible to the report/inspector projections: shapeChange has no
// case for it, and the pending-change UIs filter to style/class.
export type ChangeRecord = StyleChangeRecord | ClassChangeRecord | InsertChangeRecord | MoveChangeRecord | AnnotationChangeRecord | WireframeDirectionChange

let changeCounter = 0

function broadcast(event: string, data: unknown) {
  wsSend(event, data)
}

/** Entries the change buffer / report should surface: pending work only.
 *  'written' edits are in source (re-committing would double-apply),
 *  'applying' ones are riding an in-flight apply batch, and placement
 *  entries (instanceId) belong to the wireframe lifecycle — they surface in
 *  the placements/session panels, never in the Annotate report (placements
 *  were never report changes before the session existed either). */
function isReportable(e: ShellSessionEntry): boolean {
  return (e.live.status === 'pending' || e.live.status === 'failed') && !e.instanceId
}

/**
 * The style editor — now a façade over the design-session journal
 * (useDesignSession). The journal is ordered (append-or-amend: a continuous
 * gesture amends its entry; a non-adjacent re-edit appends) so session-wide
 * undo works across styles, classes, and placements. This façade's contract
 * is FROZEN: the public API, the collapsed `changes` view, the `report`
 * shape, and the `report:updated`/`changes:cleared` broadcasts feed the
 * Annotate tab, GET /api/report, and `annotask watch` — its test suite must
 * pass unmodified.
 */
export function useStyleEditor() {
  const session = useDesignSession()

  /**
   * Record a style change. The actual DOM mutation is done by the bridge.
   * Collapses changes so only one record per eid+property exists (projection;
   * the journal keeps gesture-grained entries for ordered undo).
   *
   * If `meta.tokenRole` is set, the change was picked from a design token
   * (e.g. 'primary') and the description/commit message references the
   * semantic name instead of the raw hex.
   */
  function applyStyle(
    eid: string,
    property: string,
    value: string,
    before: string,
    meta: { file: string; line: string; component: string; mfe?: string; tokenRole?: string }
  ) {
    const displayValue = meta.tokenRole ? `${meta.tokenRole} (${value})` : value
    const line = parseInt(meta.line) || 0
    const description = `Set ${property} to ${displayValue}`
    const gestureKey = `style|${meta.file}|${line}|${property}|${session.activeBreakpointId.value ?? ''}`

    changeCounter++
    session.record({
      change: {
        id: `s${changeCounter}`,
        type: 'style_update',
        description,
        file: meta.file,
        section: 'style',
        line,
        component: meta.component,
        ...(meta.mfe ? { mfe: meta.mfe } : {}),
        element: 'element', // tag not available here, fine for report
        property,
        before,
        after: value,
        ...(meta.tokenRole ? { tokenRole: meta.tokenRole } : {}),
      },
      anchor: { file: meta.file, line, component: meta.component, ...(meta.mfe ? { mfe: meta.mfe } : {}) },
      eid,
      amendKey: `${gestureKey}|${eid}`,
      gestureKey,
      amendTop: (top) => {
        if (top.type !== 'style_update') return
        top.after = value
        top.tokenRole = meta.tokenRole
        top.description = description
      },
    })
  }

  function recordInsert(target: { file: string; line: string; component: string; position: string }, item: CatalogItem): string {
    changeCounter++
    const id = `ci${changeCounter}`
    const isInside = target.position === 'append' || target.position === 'prepend'
    const line = parseInt(target.line) || 0

    const record: InsertChangeRecord = {
      id,
      type: 'component_insert',
      description: `Insert <${item.tag}> ${target.position} in ${target.component}`,
      file: target.file,
      section: 'template',
      line,
      component: target.component,
      insert_inside: isInside ? {
        component: target.component,
      } : undefined,
      insert_position: target.position as any,
      inserted: {
        tag: item.tag,
        library: item.library,
        props: item.defaultProps,
        classes: item.defaultClasses,
        text_content: item.defaultTextContent,
      },
    }

    session.record({
      change: record,
      anchor: { file: target.file, line, component: target.component, position: target.position as InsertChangeRecord['insert_position'] },
    })
    return id
  }

  /** Record a Reposition move of an existing app element — emits a
   *  `component_move` change for the report → /annotask-apply pipeline. */
  function recordMove(
    from: { file: string; line: number; tag: string; component?: string },
    to: { target_file: string; target_line: number; position: 'before' | 'after' | 'append' | 'prepend' },
  ): string {
    changeCounter++
    const id = `cm${changeCounter}`
    const record: MoveChangeRecord = {
      id,
      type: 'component_move',
      description: `Move <${from.tag}> ${to.position} target`,
      file: to.target_file,
      section: 'template',
      line: to.target_line,
      component: from.component,
      element_tag: from.tag,
      from_file: from.file,
      from_line: from.line,
      move_to: to,
    }
    session.record({
      change: record,
      anchor: { file: to.target_file, line: to.target_line, targetTag: from.tag, component: from.component, position: to.position },
    })
    return id
  }

  function recordAnnotation(meta: {
    file: string; line: string; component: string; mfe?: string;
    intent: string; action?: string; elementTag?: string; elementClasses?: string;
    parentLayout?: string; siblingsCount?: number; pinId?: string;
  }): string {
    changeCounter++
    const id = `an${changeCounter}`
    const line = parseInt(meta.line) || 0
    const record: AnnotationChangeRecord = {
      id,
      type: 'annotation',
      description: meta.intent,
      file: meta.file,
      section: 'template',
      line,
      component: meta.component,
      ...(meta.mfe ? { mfe: meta.mfe } : {}),
      intent: meta.intent,
      action: meta.action,
      context: {
        element_tag: meta.elementTag,
        element_classes: meta.elementClasses,
        parent_layout: meta.parentLayout,
        siblings_count: meta.siblingsCount,
      },
      pinId: meta.pinId,
    }
    session.record({
      change: record,
      anchor: { file: meta.file, line, targetTag: meta.elementTag, component: meta.component, ...(meta.mfe ? { mfe: meta.mfe } : {}) },
    })
    return id
  }

  function recordClassChange(
    eid: string,
    beforeClasses: string,
    afterClasses: string,
    meta: { file: string; line: string; component: string; mfe?: string }
  ): string {
    const lineNum = parseInt(meta.line) || 0
    const gestureKey = `class|${meta.file}|${lineNum}|${session.activeBreakpointId.value ?? ''}`

    changeCounter++
    const entry = session.record({
      change: {
        id: `cl${changeCounter}`,
        type: 'class_update',
        description: `Update classes`,
        file: meta.file,
        section: 'template',
        line: lineNum,
        component: meta.component,
        ...(meta.mfe ? { mfe: meta.mfe } : {}),
        element: 'element',
        before: { classes: beforeClasses },
        after: { classes: afterClasses },
      },
      anchor: { file: meta.file, line: lineNum, component: meta.component, ...(meta.mfe ? { mfe: meta.mfe } : {}) },
      eid,
      amendKey: `${gestureKey}|${eid}`,
      gestureKey,
      amendTop: (top) => {
        if (top.type !== 'class_update') return
        top.after = { classes: afterClasses }
        top.description = `Update classes`
      },
    })
    return entry.change.id
  }

  /**
   * Undo the last change (the session journal tail). Returns undo info so the
   * caller can delegate the actual revert to the bridge — or, for a placement
   * entry, to the wireframe deletePlacement pipeline.
   */
  function undo(): { type: string; eid?: string; property?: string; value?: string; classes?: string; instanceId?: string } | null {
    const popped = session.popForUndo()
    if (!popped) return null
    const c = popped.change

    if (c.type === 'style_update') {
      broadcast('report:updated', report.value)
      return { type: 'style', eid: popped.eid, property: c.property, value: c.before }
    } else if (c.type === 'class_update') {
      broadcast('report:updated', report.value)
      return { type: 'class', eid: popped.eid, classes: c.before.classes }
    } else if (c.type === 'component_insert') {
      broadcast('report:updated', report.value)
      if (popped.instanceId) {
        // Wireframe placement — caller deletes the instance (doc + live node).
        return { type: 'placement_delete', instanceId: popped.instanceId }
      }
      return { type: 'insert_remove', eid: popped.eid }
    }

    broadcast('report:updated', report.value)
    return null
  }

  function removeChange(id: string) {
    const entry = session.findByChangeId(id)
    if (!entry) return
    // A collapsed projection record stands for its whole amend-group — remove
    // every entry sharing the key, exactly like removing the single collapsed
    // record before the journal existed.
    if (entry.amendKey) {
      session.removeWhere((e) => e.amendKey === entry.amendKey)
    } else {
      session.removeWhere((e) => e.id === entry.id)
    }
  }

  /**
   * Remove all changes for a specific file:line (element).
   * Returns placeholder eids that need to be removed via bridge.
   * Placement entries are NOT touched — placements belong to the wireframe
   * lifecycle (deletePlacement / Build / discard), not the change buffer.
   */
  function removeChangesFor(file: string, line: number): string[] {
    const removed = session.removeWhere((e) => !e.instanceId && e.change.file === file && e.change.line === line)
    const placeholderEids: string[] = []
    for (const e of removed) {
      if (e.change.type === 'component_insert' && e.eid) placeholderEids.push(e.eid)
    }
    broadcast('report:updated', report.value)
    return placeholderEids
  }

  function removeAnnotationsByFile(file: string, line: number) {
    session.removeWhere((e) => e.change.type === 'annotation' && e.change.file === file && e.change.line === line)
  }

  /**
   * Clear all changes. Returns eids of placeholders that need to be removed via bridge.
   * Placement entries survive (see removeChangesFor) — discarding placements is
   * the session discard's job.
   */
  function clearChanges(): string[] {
    const removed = session.removeWhere((e) => !e.instanceId)
    const placeholderEids: string[] = []
    for (const e of removed) {
      if (e.change.type === 'component_insert' && e.eid) placeholderEids.push(e.eid)
    }
    broadcast('changes:cleared', {})
    return placeholderEids
  }

  function shapeChange(c: ChangeRecord): Record<string, unknown> | null {
    const line = typeof c.line === 'number' && Number.isFinite(c.line) ? c.line : 0
    const base = {
      id: c.id,
      type: c.type,
      description: c.description || '',
      file: c.file || '',
      section: c.section,
      line,
    }

    switch (c.type) {
      case 'style_update':
        return {
          ...base,
          component: c.component,
          element: c.element,
          property: c.property,
          before: c.before,
          after: c.after,
          ...(c.tokenRole ? { token_role: c.tokenRole } : {}),
        }
      case 'class_update':
        return { ...base, component: c.component, element: c.element, before: c.before, after: c.after }
      case 'component_insert':
        return { ...base, insert_inside: c.insert_inside, insert_position: c.insert_position, component: c.inserted }
      case 'component_move':
        return {
          ...base,
          element: { tag: c.element_tag, component: c.component, from_file: c.from_file, from_line: c.from_line },
          move_to: c.move_to,
        }
      case 'annotation':
        return { ...base, component: c.component, intent: c.intent, action: c.action, context: c.context }
      default:
        return null
    }
  }

  /**
   * Collapsed pending-change view — one record per amend-group, ordered by
   * first occurrence, `before` from first touch + `after` from the latest.
   * This is the projection the Annotate tab, the inspector's selection list,
   * and commit-as-task consume; the underlying journal stays gesture-grained
   * for ordered undo.
   */
  const changes = computed<ChangeRecord[]>(() => {
    const visible = session.entries.value.filter(isReportable)
    const byKey = new Map<string, ShellSessionEntry[]>()
    const order: string[] = []
    for (const e of visible) {
      const key = e.amendKey ?? `solo:${e.id}`
      const group = byKey.get(key)
      if (group) {
        group.push(e)
      } else {
        byKey.set(key, [e])
        order.push(key)
      }
    }
    return order.map((key) => {
      const group = byKey.get(key)!
      if (group.length === 1) return group[0].change
      const first = group[0].change
      const last = group[group.length - 1].change
      const collapsed = { ...last } as ChangeRecord
      if ('before' in collapsed && 'before' in first) {
        ;(collapsed as { before: unknown }).before = (first as { before: unknown }).before
      }
      return collapsed
    })
  })

  // Collapsed report — no duplicates, only final values
  const report = computed(() => {
    if (changes.value.length === 0) return null

    const meaningful = changes.value.filter(c => {
      if (c.type === 'component_insert' || c.type === 'component_move' || c.type === 'annotation') return true
      if (c.type === 'wireframe_direction') return false // apply-loop transport, never reported
      if (c.type === 'class_update') return c.before.classes !== c.after.classes
      return c.before !== c.after
    })
    if (meaningful.length === 0) return null

    // Shape each change to conform to schema, stripping internal fields
    const reportChanges = meaningful.map(shapeChange).filter(Boolean)

    const { designSpec } = useDesignSpec()
    const spec = designSpec.value
    const detectedFramework = (spec?.framework?.name || 'html') as AnnotaskReport['project']['framework']
    const project = spec?.framework ? {
      framework: detectedFramework,
      styling: spec.framework.styling || [],
      root: '',
    } : {
      framework: 'html' as const,
      styling: [] as string[],
      root: '',
    }

    const { effectiveViewport } = useViewportPreview()
    const vp = effectiveViewport.value
    const viewport = (vp.width || vp.height) ? { width: vp.width, height: vp.height } : undefined

    const { snapshotForChange } = useInteractionHistory()
    const snapshot = snapshotForChange(window.location.pathname)
    const interaction_history = snapshot.recent_actions.length > 0 ? snapshot : undefined

    return {
      version: '1.0' as const,
      project,
      ...(viewport ? { viewport } : {}),
      ...(interaction_history ? { interaction_history } : {}),
      changes: reportChanges,
    }
  })

  // Broadcast changes over WebSocket whenever they update
  watch(
    () => report.value,
    (r) => { broadcast('report:updated', r) },
    { deep: true }
  )

  return { changes, applyStyle, recordInsert, recordMove, recordAnnotation, recordClassChange, removeChange, removeChangesFor, removeAnnotationsByFile, undo, clearChanges, report, broadcast }
}
