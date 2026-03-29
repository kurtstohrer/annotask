import { ref, watch, onMounted, onUnmounted } from 'vue'

export type InteractionMode = 'select' | 'interact' | 'pin' | 'arrow' | 'draw' | 'highlight'

const stored = localStorage.getItem('annotask:mode')
const mode = ref<InteractionMode>(
  stored && ['select', 'interact', 'pin', 'arrow', 'draw', 'highlight'].includes(stored)
    ? stored as InteractionMode
    : 'select'
)

function onKeyDown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

  switch (e.key.toLowerCase()) {
    case 'v': mode.value = 'select'; break
    case 'i': mode.value = 'interact'; break
    case 'p': mode.value = 'pin'; break
    case 'a': mode.value = 'arrow'; break
    case 'd': mode.value = 'draw'; break
    case 'h': mode.value = 'highlight'; break
  }
}

watch(mode, (v) => localStorage.setItem('annotask:mode', v))

export function useInteractionMode() {
  onMounted(() => document.addEventListener('keydown', onKeyDown))
  onUnmounted(() => document.removeEventListener('keydown', onKeyDown))
  return { mode }
}
