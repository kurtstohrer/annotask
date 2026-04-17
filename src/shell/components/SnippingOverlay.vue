<template>
  <div class="snip-overlay"
    @pointerdown="$emit('pointer-down', $event)"
    @pointermove="$emit('pointer-move', $event)"
    @pointerup="$emit('pointer-up', $event)"
    @keydown.escape="$emit('cancel')">
    <div class="snip-hint">Drag to select a region, or press Esc to cancel</div>
    <div v-if="snipRect && snipRect.width > 5 && snipRect.height > 5" class="snip-selection"
      :style="{ left: snipRect.x + 'px', top: snipRect.y + 'px', width: snipRect.width + 'px', height: snipRect.height + 'px' }">
      <div class="snip-size-label">{{ Math.round(snipRect.width) }} &times; {{ Math.round(snipRect.height) }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface SnipRect {
  x: number
  y: number
  width: number
  height: number
}

interface Props {
  snipRect: SnipRect | null
}

defineProps<Props>()
defineEmits<{
  (e: 'pointer-down', event: PointerEvent): void
  (e: 'pointer-move', event: PointerEvent): void
  (e: 'pointer-up', event: PointerEvent): void
  (e: 'cancel'): void
}>()
</script>
