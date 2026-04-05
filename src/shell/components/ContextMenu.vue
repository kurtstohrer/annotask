<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
}>()

const emit = defineEmits<{
  close: []
  action: [action: string]
}>()

const menuRef = ref<HTMLElement | null>(null)

const items = [
  { id: 'move', label: 'Move', shortcut: 'M', enabled: true },
  { id: 'resize', label: 'Resize', shortcut: 'R', enabled: true },
  { id: 'separator' },
  { id: 'duplicate', label: 'Duplicate', enabled: false },
  { id: 'delete', label: 'Delete', enabled: false },
]

function onSelect(id: string) {
  emit('action', id)
  emit('close')
}

function onClickOutside(e: MouseEvent) {
  if (!props.visible) return
  if (menuRef.value?.contains(e.target as Node)) return
  emit('close')
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('mousedown', onClickOutside)
  document.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onClickOutside)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="context-menu"
      :style="{ left: x + 'px', top: y + 'px' }"
    >
      <template v-for="item in items" :key="item.id">
        <div v-if="item.id === 'separator'" class="separator" />
        <button
          v-else
          class="menu-item"
          :class="{ disabled: !item.enabled }"
          :disabled="!item.enabled"
          @click="item.enabled && onSelect(item.id)"
        >
          <span class="item-label">{{ item.label }}</span>
          <span v-if="item.shortcut" class="item-shortcut">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 20000;
  min-width: 160px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px var(--shadow);
  padding: 4px;
  overflow: hidden;
}

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 12px;
  background: none;
  border: none;
  border-radius: 5px;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.1s;
}
.menu-item:hover:not(.disabled) { background: var(--surface-2); }
.menu-item.disabled { color: var(--text-muted); cursor: not-allowed; opacity: 0.5; }

.item-shortcut { font-size: 10px; color: var(--text-muted); font-family: 'SF Mono', monospace; }

.separator { height: 1px; background: var(--border); margin: 4px 8px; }
</style>
