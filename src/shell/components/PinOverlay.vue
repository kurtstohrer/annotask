<script setup lang="ts">
import type { Pin } from '../composables/useAnnotations'

defineProps<{
  pins: Pin[]
  selectedPinId: string | null
  iframeOffset: { x: number; y: number }
}>()

const emit = defineEmits<{
  'select-pin': [id: string]
  'remove-pin': [id: string]
}>()
</script>

<template>
  <div
    v-for="pin in pins"
    :key="pin.id"
    class="pin"
    :class="{ selected: pin.id === selectedPinId, 'has-action': !!pin.action, 'has-note': !!pin.note }"
    :style="{
      left: (iframeOffset.x + pin.clickX) + 'px',
      top: (iframeOffset.y + pin.clickY) + 'px',
    }"
    @click.stop="emit('select-pin', pin.id)"
  >
    <span class="pin-number">{{ pin.number }}</span>
    <button class="pin-remove" @click.stop="emit('remove-pin', pin.id)">×</button>
  </div>
</template>

<style scoped>
.pin {
  position: fixed;
  z-index: 10003;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #3b82f6;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transform: translate(-11px, -11px);
  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  transition: all 0.15s;
  border: 2px solid white;
}
.pin:hover { transform: translate(-11px, -11px) scale(1.2); }
.pin.selected { background: #2563eb; box-shadow: 0 0 0 3px rgba(59,130,246,0.3), 0 2px 6px rgba(0,0,0,0.3); }
.pin.has-action { background: #a855f7; }
.pin.has-note.has-action { background: #7c3aed; }

.pin-number { font-size: 10px; font-weight: 700; }

.pin-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--danger, #ef4444);
  color: white;
  border: 1px solid white;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.pin:hover .pin-remove { display: flex; }
</style>
