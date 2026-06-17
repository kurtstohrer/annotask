import { ref } from 'vue'
import type { WireframeKind } from '../../shared/wireframe-types'

/**
 * A normalized palette item being dragged — superset of CatalogItem (HTML /
 * layout-preset) and a live project/library component.
 */
export interface PaletteDragItem {
  kind: WireframeKind
  /** Component constructor name (kind === 'component') or the HTML/preset tag. */
  componentName: string
  tag: string
  label: string
  library?: string
  /** Import specifier (e.g. "primevue/button") for on-demand loading. */
  module?: string
  props?: Record<string, unknown>
  /** Sample props for the live mount/preview only — NOT persisted as real props. */
  previewProps?: Record<string, unknown>
  classes?: string
  textContent?: string
  /** CatalogItem category (e.g. 'layout-preset') — drives placeholder styling. */
  category?: string
  /** Scanner hint so the drop can predict fidelity before mounting. */
  fidelityHint?: 'live' | 'isolated-preview' | 'placeholder' | 'unknown'
  /** Owning MFE id (the component's home package), carried from the palette
   *  through the drop so the placed block can be stamped. */
  mfe?: string
}

// Module-singleton: native HTML5 drag events block `dataTransfer.getData` during
// `dragover`, so the drop-shield and live drop indicator read the in-flight drag
// identity from this shared ref instead of the event.
const draggingItem = ref<PaletteDragItem | null>(null)

export function usePaletteDrag() {
  function startDrag(item: PaletteDragItem): void {
    draggingItem.value = item
  }
  function endDrag(): void {
    draggingItem.value = null
  }
  return { draggingItem, startDrag, endDrag }
}
