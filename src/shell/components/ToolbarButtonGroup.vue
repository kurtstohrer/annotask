<template>
  <div class="toolbar-button-group">
    <button :class="['tool-btn', { active: showSettings }]" @click="toggleSettings" title="Settings">
      <Icon name="settings" />
    </button>
    <button :class="['tool-btn', { active: showShortcuts }]" @click="toggleShortcuts" title="Help & Keyboard Shortcuts (?)">?</button>
  </div>
</template>

<script setup lang="ts">
import Icon from './Icon.vue'

interface Props {
  showSettings: boolean
  showShortcuts: boolean
}

interface Emits {
  (e: 'toggle-settings'): void
  (e: 'toggle-shortcuts'): void
}

defineProps<Props>()
const emit = defineEmits<Emits>()

function toggleSettings() {
  emit('toggle-settings')
}

function toggleShortcuts() {
  emit('toggle-shortcuts')
}
</script>

<style scoped>
.toolbar-button-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
