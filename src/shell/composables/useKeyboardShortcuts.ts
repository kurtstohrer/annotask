import { onMounted, onUnmounted } from 'vue'
import type { Ref } from 'vue'

export interface KeyboardShortcutDeps {
  snipActive: Ref<boolean>
  showReportPanel: Ref<boolean>
  showShortcuts: Ref<boolean>
  showContext: Ref<boolean>
  pendingTaskCreation: Ref<unknown | null>
  primarySelection: Ref<unknown | null>
  selectedEids: Ref<string[]>
  templateGroupEids: Ref<string[]>
  selectionRects: Ref<unknown[]>
  groupRects: Ref<unknown[]>
  activePanel: Ref<'inspector' | 'tasks'>
  doUndo: () => void
  cancelSnip: () => void
  cancelPendingTask: () => void
  layoutOverlayToggle: () => void
}

export function useKeyboardShortcuts(deps: KeyboardShortcutDeps) {
  const showShortcuts = deps.showShortcuts

  function onShellKeyDown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey

    if (mod && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      deps.doUndo()
      return
    }

    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

    const key = e.key

    if (key === '?' || (key === '/' && e.shiftKey)) {
      showShortcuts.value = !showShortcuts.value
      if (showShortcuts.value) deps.showContext.value = false
      return
    }

    if (key === 'Escape') {
      if (deps.snipActive.value) { deps.cancelSnip(); return }
      if (deps.showReportPanel.value) { deps.showReportPanel.value = false; return }
      if (showShortcuts.value) { showShortcuts.value = false; return }
      if (deps.showContext.value) { deps.showContext.value = false; return }
      if (deps.pendingTaskCreation.value) { deps.cancelPendingTask(); return }
      deps.primarySelection.value = null
      deps.selectedEids.value = []
      deps.templateGroupEids.value = []
      deps.selectionRects.value = []
      deps.groupRects.value = []
      return
    }

    if ((key === 'l' || key === 'L') && !mod) {
      deps.layoutOverlayToggle()
      return
    }

    if (key === 't' || key === 'T') {
      if (!mod) { deps.activePanel.value = deps.activePanel.value === 'tasks' ? 'inspector' : 'tasks'; return }
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', onShellKeyDown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', onShellKeyDown)
  })

  return { showShortcuts }
}
