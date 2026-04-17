import type { Ref } from 'vue'
import type { ClickElementEvent, HoverEnterEvent } from '../../shared/bridge-types'
import type { useIframeManager } from './useIframeManager'
import type { useAnnotations } from './useAnnotations'
import type { useInteractionHistory } from './useInteractionHistory'
import type { useErrorMonitor } from './useErrorMonitor'
import type { InteractionMode } from './useInteractionMode'
import type { ShellView } from './useShellNavigation'
import type { SelectionData } from './useSelectionModel'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface PendingTaskCreation {
  kind: 'pin' | 'arrow' | 'select' | 'highlight'
  label: string
  file?: string
  line?: number | string
  component?: string
  annotationId?: string
  meta: Record<string, unknown>
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
}

export interface BridgeEventHandlerDeps {
  iframe: ReturnType<typeof useIframeManager>
  iframeRef: Ref<HTMLIFrameElement | null>
  annotations: ReturnType<typeof useAnnotations>
  interactionHistory: ReturnType<typeof useInteractionHistory>
  errorMonitor: ReturnType<typeof useErrorMonitor>

  // Mode + view state
  interactionMode: Ref<InteractionMode>
  shellView: Ref<ShellView>
  highlightColor: Ref<string>

  // Selection state
  primarySelection: Ref<SelectionData | null>
  selectedEids: Ref<string[]>
  templateGroupEids: Ref<string[]>
  applyToGroup: Ref<boolean>
  editingClasses: Ref<string>
  hoverRect: Ref<Rect | null>
  hoverInfo: Ref<{ tag: string; file: string; component: string } | null>

  // Selection operations
  readLiveStyles: () => Promise<void>
  refreshRects: () => Promise<void>
  refreshElementRole: () => Promise<void>

  // Task workflow state + actions
  pendingTaskCreation: Ref<PendingTaskCreation | null>
  pendingTaskText: Ref<string>
  describeElement: (args: { file: string; line: string; component: string; tag: string; classes?: string; text?: string } | null) => string
  discardUncommittedAnnotations: () => void
  restoreAnnotationsFromTasks: () => Promise<void>
  resolveSelectTaskEids: () => void

  // Misc
  contextMenu: Ref<ContextMenuState>
  currentRoute: Ref<string>
  doUndo: () => void
  scheduleAutoScan: () => void
}

/**
 * Register all iframe bridge event handlers. The `setup()` function wires every
 * subscription and initializes passive monitors. Call from `onMounted`.
 */
export function useBridgeEventHandlers(deps: BridgeEventHandlerDeps) {
  const {
    iframe, iframeRef, annotations, interactionHistory, errorMonitor,
    interactionMode, shellView, highlightColor,
    primarySelection, selectedEids, templateGroupEids, applyToGroup,
    editingClasses, hoverRect, hoverInfo,
    readLiveStyles, refreshRects, refreshElementRole,
    pendingTaskCreation, pendingTaskText,
    describeElement, discardUncommittedAnnotations,
    restoreAnnotationsFromTasks, resolveSelectTaskEids,
    contextMenu, currentRoute,
    doUndo, scheduleAutoScan,
  } = deps

  function onHoverEnter(data: HoverEnterEvent) {
    const shellRect = iframe.toShellRect(data.rect)
    hoverRect.value = shellRect
    hoverInfo.value = data.file ? { tag: data.tag, file: data.file, component: data.component } : null
  }

  function onHoverLeave() {
    hoverRect.value = null
    hoverInfo.value = null
  }

  async function onClickElement(data: ClickElementEvent) {
    const { file, line, component, mfe, tag: tagName, classes, eid, shiftKey, clientX, clientY, text } = data

    // Pin mode: create pin at exact click position → open task creation panel
    if (interactionMode.value === 'pin') {
      discardUncommittedAnnotations()
      const pinX = clientX
      const pinY = clientY
      const pin = annotations.addPin(
        { file, line, component, elementTag: tagName, elementClasses: classes },
        pinX, pinY
      )
      pendingTaskCreation.value = {
        kind: 'pin',
        label: `Pin on ${describeElement({ file, line, component, tag: tagName, classes, text })}`,
        file, line, component,
        annotationId: pin.id,
        meta: { elementTag: tagName, elementClasses: classes, pinX, pinY, elementText: text || '' },
      }
      pendingTaskText.value = ''
      return
    }

    if (shiftKey && primarySelection.value) {
      const idx = selectedEids.value.indexOf(eid)
      if (idx >= 0) {
        selectedEids.value.splice(idx, 1)
        if (selectedEids.value.length === 0) {
          primarySelection.value = null
          templateGroupEids.value = []
          if (pendingTaskCreation.value?.kind === 'select') {
            pendingTaskCreation.value = null
            pendingTaskText.value = ''
          }
        }
      } else {
        selectedEids.value.push(eid)
      }
      await refreshRects()
      if (pendingTaskCreation.value?.kind === 'select' && selectedEids.value.length > 0) {
        const elements = (pendingTaskCreation.value.meta.selectedElements as Array<Record<string, string>>) || []
        if (idx >= 0) {
          // Removed element — filter it out
          pendingTaskCreation.value = {
            ...pendingTaskCreation.value,
            label: `${selectedEids.value.length} element${selectedEids.value.length === 1 ? '' : 's'} selected`,
            meta: { ...pendingTaskCreation.value.meta, selectedElements: elements.filter((e: Record<string, string>) => e.eid !== eid) },
          }
        } else {
          // Added element
          pendingTaskCreation.value = {
            ...pendingTaskCreation.value,
            label: `${selectedEids.value.length} element${selectedEids.value.length === 1 ? '' : 's'} selected`,
            meta: { ...pendingTaskCreation.value.meta, selectedElements: [...elements, { eid, file, line, component, tag: tagName, classes }] },
          }
        }
      }
    } else {
      primarySelection.value = { file, line, component, mfe: mfe || '', tagName, classes, eid, text }
      selectedEids.value = [eid]
      const group = await iframe.findTemplateGroup(file, line, tagName)
      templateGroupEids.value = group.eids
      applyToGroup.value = group.eids.length > 1
      editingClasses.value = classes
      await readLiveStyles()
      await refreshElementRole()
      await refreshRects()

      if (interactionMode.value === 'select' && shellView.value === 'editor') {
        pendingTaskCreation.value = {
          kind: 'select',
          label: `1 element selected`,
          file, line, component,
          meta: {
            elementTag: tagName, elementClasses: classes, elementText: text || '',
            selectedElements: [{ eid, file, line, component, tag: tagName, classes, text: text || '' }],
          },
        }
        pendingTaskText.value = ''
      }
    }

    hoverRect.value = null
  }

  async function onContextMenu(data: ClickElementEvent) {
    const { file, line, component, mfe = '', tag: tagName, classes, eid, text } = data
    const shellRect = iframe.toShellRect(data.rect)
    primarySelection.value = { file, line, component, mfe, tagName, classes, eid, text }
    selectedEids.value = [eid]
    await readLiveStyles()
    await refreshElementRole()
    contextMenu.value = {
      visible: true,
      x: shellRect ? shellRect.x + shellRect.width / 2 : data.clientX,
      y: shellRect ? shellRect.y + shellRect.height / 2 : data.clientY,
    }
  }

  async function onSelectionText(data: {
    text: string; eid: string; file: string; line: number; component: string; tag: string
    rect?: { x: number; y: number; width: number; height: number }
  }) {
    discardUncommittedAnnotations()
    // Convert iframe-local rect to viewport coords
    const iframeEl = iframeRef.value
    const offsetX = iframeEl?.getBoundingClientRect().left || 0
    const offsetY = iframeEl?.getBoundingClientRect().top || 0
    let viewportRect: { x: number; y: number; width: number; height: number } | undefined
    if (data.rect) {
      viewportRect = { x: data.rect.x + offsetX, y: data.rect.y + offsetY, width: data.rect.width, height: data.rect.height }
    }
    const hl = annotations.addHighlight(
      data.text,
      { file: data.file, line: data.line, component: data.component, elementTag: data.tag },
      highlightColor.value,
      viewportRect,
      data.eid
    )
    // Fallback: resolve element rect by eid if bridge didn't send selection rect
    if (!viewportRect && data.eid) {
      const elRect = await iframe.getElementRect(data.eid)
      if (elRect) annotations.updateHighlight(hl.id, { rect: elRect })
    }
    pendingTaskCreation.value = {
      kind: 'highlight',
      label: `Text highlight`,
      file: data.file,
      line: data.line,
      component: data.component,
      annotationId: hl.id,
      meta: { selectedText: data.text, elementTag: data.tag },
    }
    pendingTaskText.value = data.text
  }

  function onKeydown(data: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    if ((data.ctrlKey || data.metaKey) && data.key === 'z' && !data.shiftKey) {
      doUndo()
    }
  }

  async function onRouteChanged(data: { path: string }) {
    annotations.setRoute(data.path)
    localStorage.setItem('annotask:lastRoute', data.path)
    // Restore any tasks for the new route that haven't been loaded yet
    await restoreAnnotationsFromTasks()
    // Re-resolve eids for the freshly mounted route's annotations so they track scroll/resize
    resolveSelectTaskEids()
    // Auto-scan: lightweight scans on navigation
    scheduleAutoScan()
  }

  function onUserAction(data: { tag: string; text: string; href: string }) {
    interactionHistory.push('action', currentRoute.value, data)
  }

  /** Subscribe all handlers and initialize the passive error monitor. */
  function setup() {
    iframe.onBridgeEvent('hover:enter', onHoverEnter)
    iframe.onBridgeEvent('hover:leave', onHoverLeave)
    iframe.onBridgeEvent('click:element', onClickElement)
    iframe.onBridgeEvent('contextmenu:element', onContextMenu)
    iframe.onBridgeEvent('selection:text', onSelectionText)
    iframe.onBridgeEvent('keydown', onKeydown)
    iframe.onBridgeEvent('route:changed', onRouteChanged)
    iframe.onBridgeEvent('user:action', onUserAction)
    errorMonitor.init()
  }

  return { setup }
}
