<script setup lang="ts">
defineProps<{
  message: string
  confirmLabel?: string
  cancelLabel?: string
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <div class="confirm-backdrop" @click="emit('cancel')">
    <div class="confirm-dialog" @click.stop>
      <p class="confirm-message">{{ message }}</p>
      <div class="confirm-actions">
        <button class="confirm-cancel" @click="emit('cancel')">{{ cancelLabel || 'Cancel' }}</button>
        <button class="confirm-ok" @click="emit('confirm')">{{ confirmLabel || 'Delete' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-backdrop {
  position: fixed; inset: 0; z-index: 100000;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
}
.confirm-dialog {
  background: var(--surface, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  padding: 20px 24px;
  width: 320px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.confirm-message {
  font-size: 13px; color: var(--text, #e4e4e7);
  margin: 0 0 16px; line-height: 1.5;
}
.confirm-actions {
  display: flex; gap: 8px; justify-content: flex-end;
}
.confirm-cancel, .confirm-ok {
  padding: 6px 16px; font-size: 12px; font-weight: 600;
  border: none; border-radius: 6px; cursor: pointer;
  transition: all 0.12s;
}
.confirm-cancel {
  background: var(--surface-2, #252525); color: var(--text-muted, #a1a1aa);
}
.confirm-cancel:hover { background: var(--border, #333); color: var(--text, #e4e4e7); }
.confirm-ok {
  background: rgba(239, 68, 68, 0.15); color: #ef4444;
}
.confirm-ok:hover { background: #ef4444; color: white; }
</style>
