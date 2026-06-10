import { ref } from 'vue'

/**
 * State for the Reposition tool — a Design-mode tool that lets the user drag any
 * element on the page to a new location. It reuses the wireframe drop machinery
 * (resolveElementAt + dropPositionFor + the drop indicator); this composable
 * only holds the in-flight move state and the instance→container map so a
 * grabbed node can be identified as a wireframe placement.
 *
 * Two kinds of moves:
 *  - a wireframe placement (`movingInstanceId` set) → update its anchor
 *  - an existing app element → record a `component_move` change for codegen
 */
export interface RepositionGrab {
  /** Live element id of the node being moved. */
  eid: string
  /** Set when the grabbed node is a wireframe placement container. */
  instanceId?: string
  tag: string
  /** Source anchor of an app element (absent for wireframe placements). */
  file?: string
  line?: string
  component?: string
}

export function useRepositionMode() {
  // instanceId → live container eid, populated on drop + on reapply. Runtime
  // only — never persisted (container eids are session-volatile).
  const containerEids = new Map<string, string>()
  // The node currently being dragged, or null when idle.
  const grab = ref<RepositionGrab | null>(null)

  function registerContainer(instanceId: string, containerEid: string): void {
    containerEids.set(instanceId, containerEid)
  }

  function clearContainers(): void {
    containerEids.clear()
  }

  function beginGrab(g: RepositionGrab): void {
    grab.value = g
  }

  function endGrab(): void {
    grab.value = null
  }

  return { containerEids, grab, registerContainer, clearContainers, beginGrab, endGrab }
}
