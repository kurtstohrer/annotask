import { ref, computed, watch } from 'vue'
import type { CatalogItem } from '../types'
import { useDesignSpec } from './useDesignSpec'
import { useViewportPreview } from './useViewportPreview'
import { useInteractionHistory } from './useInteractionHistory'
import { send as wsSend } from '../services/wsClient'

export interface StyleChangeRecord {
  id: string
  type: 'style_update'
  description: string
  file: string
  section: 'template' | 'style'
  line: number
  component: string
  element: string
  property: string
  before: string
  after: string
}

export interface InsertChangeRecord {
  id: string
  type: 'component_insert'
  description: string
  file: string
  section: 'template'
  line: number
  component?: string
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
  element: string
  before: { classes: string }
  after: { classes: string }
}

export type ChangeRecord = StyleChangeRecord | ClassChangeRecord | InsertChangeRecord | MoveChangeRecord | AnnotationChangeRecord

const changes = ref<ChangeRecord[]>([])
let changeCounter = 0

// Map change id → eid for undo/collapse tracking
const eidRefs = new Map<string, string>()

function broadcast(event: string, data: unknown) {
  wsSend(event, data)
}

export function useStyleEditor() {
  /**
   * Record a style change. The actual DOM mutation is done by the bridge.
   * Collapses changes so only one record per eid+property exists.
   */
  function applyStyle(
    eid: string,
    property: string,
    value: string,
    before: string,
    meta: { file: string; line: string; component: string }
  ) {
    // Find existing change for this eid + property + source location
    const existing = changes.value.find(
      c => c.type === 'style_update' && c.file === meta.file && c.line === (parseInt(meta.line) || 0)
        && c.property === property && eidRefs.get(c.id) === eid
    ) as StyleChangeRecord | undefined

    if (existing) {
      existing.after = value
      existing.description = `Set ${property} to ${value}`
    } else {
      changeCounter++
      const id = `s${changeCounter}`
      changes.value.push({
        id,
        type: 'style_update',
        description: `Set ${property} to ${value}`,
        file: meta.file,
        section: 'style',
        line: parseInt(meta.line) || 0,
        component: meta.component,
        element: 'element', // tag not available here, fine for report
        property,
        before,
        after: value,
      })
      eidRefs.set(id, eid)
    }
  }

  function recordInsert(target: { file: string; line: string; component: string; position: string }, item: CatalogItem): string {
    changeCounter++
    const id = `ci${changeCounter}`
    const isInside = target.position === 'append' || target.position === 'prepend'

    const record: InsertChangeRecord = {
      id,
      type: 'component_insert',
      description: `Insert <${item.tag}> ${target.position} in ${target.component}`,
      file: target.file,
      section: 'template',
      line: parseInt(target.line) || 0,
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

    changes.value.push(record)
    return id
  }

  function recordAnnotation(meta: {
    file: string; line: string; component: string;
    intent: string; action?: string; elementTag?: string; elementClasses?: string;
    parentLayout?: string; siblingsCount?: number; pinId?: string;
  }): string {
    changeCounter++
    const id = `an${changeCounter}`
    const record: AnnotationChangeRecord = {
      id,
      type: 'annotation',
      description: meta.intent,
      file: meta.file,
      section: 'template',
      line: parseInt(meta.line) || 0,
      component: meta.component,
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
    changes.value.push(record)
    return id
  }

  function recordClassChange(
    eid: string,
    beforeClasses: string,
    afterClasses: string,
    meta: { file: string; line: string; component: string }
  ): string {
    const lineNum = parseInt(meta.line) || 0
    const existing = changes.value.find(c => {
      if (c.type !== 'class_update') return false
      if (c.file !== meta.file || c.line !== lineNum) return false
      return eidRefs.get(c.id) === eid
    }) as ClassChangeRecord | undefined

    if (existing) {
      existing.after = { classes: afterClasses }
      existing.description = `Update classes`
      return existing.id
    }

    changeCounter++
    const id = `cl${changeCounter}`
    changes.value.push({
      id,
      type: 'class_update',
      description: `Update classes`,
      file: meta.file,
      section: 'template',
      line: lineNum,
      component: meta.component,
      element: 'element',
      before: { classes: beforeClasses },
      after: { classes: afterClasses },
    })
    eidRefs.set(id, eid)
    return id
  }

  /**
   * Undo the last change. Returns undo info so the caller can
   * delegate the actual DOM revert to the bridge.
   */
  function undo(): { type: string; eid?: string; property?: string; value?: string; classes?: string } | null {
    if (changes.value.length === 0) return null

    const last = changes.value.pop()!

    if (last.type === 'style_update') {
      const eid = eidRefs.get(last.id)
      eidRefs.delete(last.id)
      broadcast('report:updated', report.value)
      return { type: 'style', eid, property: last.property, value: last.before }
    } else if (last.type === 'class_update') {
      const eid = eidRefs.get(last.id)
      eidRefs.delete(last.id)
      broadcast('report:updated', report.value)
      return { type: 'class', eid, classes: last.before.classes }
    } else if (last.type === 'component_insert') {
      const eid = eidRefs.get(last.id)
      eidRefs.delete(last.id)
      broadcast('report:updated', report.value)
      return { type: 'insert_remove', eid }
    }

    broadcast('report:updated', report.value)
    return null
  }

  function removeChange(id: string) {
    changes.value = changes.value.filter(c => c.id !== id)
    eidRefs.delete(id)
  }

  function removeAnnotationsByFile(file: string, line: number) {
    changes.value = changes.value.filter(c => {
      if (c.type !== 'annotation') return true
      return !(c.file === file && c.line === line)
    })
  }

  /**
   * Clear all changes. Returns eids of placeholders that need to be removed via bridge.
   */
  function clearChanges(): string[] {
    const placeholderEids: string[] = []
    for (const c of changes.value) {
      if (c.type === 'component_insert') {
        const eid = eidRefs.get(c.id)
        if (eid) placeholderEids.push(eid)
      }
    }
    changes.value = []
    eidRefs.clear()
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
        return { ...base, component: c.component, element: c.element, property: c.property, before: c.before, after: c.after }
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

  // Collapsed report — no duplicates, only final values
  const report = computed(() => {
    if (changes.value.length === 0) return null

    const meaningful = changes.value.filter(c => {
      if (c.type === 'component_insert' || c.type === 'component_move' || c.type === 'annotation') return true
      if (c.type === 'class_update') return c.before.classes !== c.after.classes
      return c.before !== c.after
    })
    if (meaningful.length === 0) return null

    // Shape each change to conform to schema, stripping internal fields
    const reportChanges = meaningful.map(shapeChange).filter(Boolean)

    const { designSpec } = useDesignSpec()
    const spec = designSpec.value
    const project = spec?.framework ? {
      framework: (spec.framework.name || 'vue') as 'vue' | 'react' | 'svelte',
      styling: spec.framework.styling || [],
      root: '',
    } : {
      framework: 'vue' as const,
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

  return { changes, applyStyle, recordInsert, recordAnnotation, recordClassChange, removeChange, removeAnnotationsByFile, undo, clearChanges, report, broadcast }
}
