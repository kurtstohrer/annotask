<template>
  <div class="fullscreen-overlay">
    <FullscreenOverlayHeader title="Component Context" @close="$emit('close')" />
    <LibrariesPage />
  </div>
</template>

<script setup lang="ts">
import FullscreenOverlayHeader from './FullscreenOverlayHeader.vue'
import LibrariesPage from './LibrariesPage.vue'

defineEmits<{
  (e: 'close'): void
}>()
</script>
