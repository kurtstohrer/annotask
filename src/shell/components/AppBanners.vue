<template>
  <div>
    <div v-if="showWarning" class="warning-banner">
      Source mapping unavailable — ensure the Annotask plugin is configured in your build tool.
    </div>
    <div v-if="!configInitialized" class="setup-banner">
      Annotask not initialized — run <code>/annotask-init</code> in your AI assistant to set up project tokens and component detection.
    </div>
    <!-- Wireframe capture/enter failure. The canvas (which normally renders this
         error) unmounts when entry fails, so without this the message flashes
         and vanishes. Surface it here, dismissibly, instead. -->
    <div v-if="wireframeError" class="warning-banner" data-testid="wireframe-error-banner">
      Wireframe: {{ wireframeError }}
      <button class="banner-dismiss" type="button" @click="$emit('dismiss-wireframe-error')">Dismiss</button>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  showWarning: boolean
  configInitialized: boolean
  /** Wireframe capture/enter error to surface when the canvas isn't mounted. */
  wireframeError?: string | null
}

defineProps<Props>()
defineEmits<{ 'dismiss-wireframe-error': [] }>()
</script>

<style scoped>
.banner-dismiss {
  margin-left: 8px;
  padding: 1px 8px;
  font-size: 11px;
  background: transparent;
  border: 1px solid currentColor;
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  opacity: 0.8;
}
.banner-dismiss:hover { opacity: 1; }
</style>
