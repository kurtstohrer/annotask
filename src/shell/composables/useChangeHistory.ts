import { computed, type Ref } from 'vue'
import type { useStyleEditor, StyleChangeRecord, ClassChangeRecord } from './useStyleEditor'
import type { useIframeManager } from './useIframeManager'
import type { SelectionData } from './useSelectionModel'
import type { ElementRole } from './useElementClassification'
import type { ShellView } from './useShellNavigation'

/**
 * Undo / clear / commit-as-task for the style editor's change buffer.
 *
 * Extracted from App.vue because it has a coherent job (manage the pending-change
 * buffer lifecycle) and ties the style editor, the iframe bridge, the current
 * selection, the active shell view, and the task-creation callback together in
 * one place. App.vue should only wire these refs/methods to buttons.
 */
export function useChangeHistory(deps: {
  styleEditor: ReturnType<typeof useStyleEditor>
  iframe: ReturnType<typeof useIframeManager>
  primarySelection: Ref<SelectionData | null>
  selectedEids: Ref<string[]>
  templateGroupEids: Ref<string[]>
  selectedElementRole: Ref<ElementRole | null>
  shellView: Ref<ShellView>
  readLiveStyles: () => Promise<void>
  createRouteTask: (data: Record<string, unknown>) => Promise<unknown>
}) {
  const { styleEditor, iframe, primarySelection, selectedEids, templateGroupEids, selectedElementRole, shellView, readLiveStyles, createRouteTask } = deps
  const { changes } = styleEditor

  /** Changes scoped to the currently-selected element (for the inspector panel). */
  const selectionChanges = computed(() => {
    const sel = primarySelection.value
    if (!sel) return []
    const line = parseInt(sel.line) || 0
    return changes.value.filter(c => c.file === sel.file && c.line === line)
  })

  async function doUndo() {
    const undoInfo = styleEditor.undo()
    if (!undoInfo) return
    if (undoInfo.type === 'style' && undoInfo.eid) {
      await iframe.undoStyle(undoInfo.eid, undoInfo.property!, undoInfo.value || '')
    } else if (undoInfo.type === 'class' && undoInfo.eid) {
      await iframe.undoClass(undoInfo.eid, undoInfo.classes || '')
    } else if (undoInfo.type === 'insert_remove' && undoInfo.eid) {
      await iframe.removePlaceholder(undoInfo.eid)
    }
    await readLiveStyles()
  }

  async function doClearChanges() {
    const sel = primarySelection.value
    if (sel && shellView.value === 'design') {
      const placeholderEids = styleEditor.removeChangesFor(sel.file, parseInt(sel.line) || 0)
      for (const eid of placeholderEids) {
        await iframe.removePlaceholder(eid)
      }
    } else {
      const placeholderEids = styleEditor.clearChanges()
      for (const eid of placeholderEids) {
        await iframe.removePlaceholder(eid)
      }
    }
  }

  async function commitChangesAsTask() {
    const sel = primarySelection.value
    const scope = selectionChanges.value.length > 0 ? selectionChanges.value : changes.value
    if (scope.length === 0) return

    const styleChanges = scope.filter(c => c.type === 'style_update') as StyleChangeRecord[]
    const classChanges = scope.filter(c => c.type === 'class_update') as ClassChangeRecord[]

    // Deduplicate: apply-to-group creates one record per eid, but the property change is the same.
    const seenProps = new Set<string>()
    const dedupedStyleChanges: typeof styleChanges = []
    for (const c of styleChanges) {
      const key = `${c.property}:${c.after}`
      if (!seenProps.has(key)) { seenProps.add(key); dedupedStyleChanges.push(c) }
    }
    const seenClassKeys = new Set<string>()
    const dedupedClassChanges: typeof classChanges = []
    for (const c of classChanges) {
      const key = c.after.classes
      if (!seenClassKeys.has(key)) { seenClassKeys.add(key); dedupedClassChanges.push(c) }
    }

    // Human-readable description from the deduplicated changes.
    // If a token role is set, use the semantic name (e.g. "color: primary")
    // rather than the raw value — tells the agent to apply a token, not a hex.
    const parts: string[] = []
    for (const c of dedupedStyleChanges) {
      const display = c.tokenRole ? `${c.tokenRole} (${c.after})` : c.after
      parts.push(`${c.property}: ${display}`)
    }
    for (const c of dedupedClassChanges) parts.push(`classes: ${c.after.classes}`)

    const elementDesc = sel ? `<${sel.tagName}>${sel.component ? ` in ${sel.component}` : ''}` : ''
    const changeDesc = parts.length <= 3
      ? parts.join(', ')
      : `${parts.slice(0, 2).join(', ')} and ${parts.length - 2} more`
    const description = elementDesc
      ? `Update ${changeDesc} on ${elementDesc}`
      : `Update ${changeDesc}`

    const file = sel?.file || styleChanges[0]?.file || classChanges[0]?.file || ''
    const line = sel?.line ? parseInt(sel.line) : (styleChanges[0]?.line || classChanges[0]?.line || 0)
    const component = sel?.component || styleChanges[0]?.component || classChanges[0]?.component || ''

    const taskChanges: Array<Record<string, unknown>> = []
    for (const c of dedupedStyleChanges) {
      taskChanges.push({
        property: c.property,
        before: c.before,
        after: c.after,
        file: c.file,
        line: c.line,
        ...(c.tokenRole ? { token_role: c.tokenRole } : {}),
      })
    }
    for (const c of dedupedClassChanges) {
      taskChanges.push({ type: 'class', before: c.before.classes, after: c.after.classes, file: c.file, line: c.line })
    }

    const elementContext: Record<string, unknown> = {}
    if (sel) {
      elementContext.element_tag = sel.tagName
      elementContext.element_classes = sel.classes
      if (selectedElementRole.value) elementContext.element_role = selectedElementRole.value
      if (templateGroupEids.value.length > 1) elementContext.template_instances = templateGroupEids.value.length
    }

    const eids = [...selectedEids.value]

    await createRouteTask({
      type: 'style_update',
      description,
      file,
      line,
      component,
      ...(eids.length ? { visual: { kind: 'select' as const, eids } } : {}),
      context: { changes: taskChanges, ...elementContext },
    })

    // Remove only this selection's changes after commit (in theme view); otherwise clear all.
    if (sel && shellView.value === 'design') {
      styleEditor.removeChangesFor(file, typeof line === 'number' ? line : parseInt(line) || 0)
    } else {
      await doClearChanges()
    }
  }

  return { selectionChanges, doUndo, doClearChanges, commitChangesAsTask }
}
