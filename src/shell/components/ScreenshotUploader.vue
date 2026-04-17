<template>
  <div class="screenshot-uploader">
    <div v-if="pendingScreenshot" class="screenshot-preview">
      <img :src="'/__annotask/screenshots/' + pendingScreenshot" class="screenshot-thumb" />
      <button class="screenshot-remove" @click="$emit('remove-screenshot')" title="Remove screenshot">&times;</button>
    </div>
    <button v-else class="screenshot-btn" @click="$emit('start-snip')" title="Take a screenshot of your work">
      📷 Add Screenshot
    </button>
  </div>
</template>

<script setup lang="ts">
interface Props {
  pendingScreenshot?: string | null
}

interface Emits {
  (e: 'start-snip'): void
  (e: 'remove-screenshot'): void
}

defineProps<Props>()
defineEmits<Emits>()
</script>

<style scoped>
.screenshot-uploader {
  width: 100%;
}

.screenshot-preview {
  position: relative;
  margin-top: 4px;
}

.screenshot-thumb {
  width: 100%;
  border-radius: 4px;
  border: 1px solid var(--border);
}

.screenshot-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.screenshot-remove:hover {
  background: var(--danger);
}

.screenshot-btn {
  width: 100%;
  padding: 5px;
  margin-top: 4px;
  font-size: 10px;
  font-weight: 600;
  background: var(--surface-2);
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 5px;
  cursor: pointer;
}

.screenshot-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
