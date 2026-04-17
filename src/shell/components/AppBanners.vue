<template>
  <div>
    <div v-if="showWarning" class="warning-banner">
      Source mapping unavailable — ensure the Annotask plugin is configured in your build tool.
    </div>
    <div v-if="!configInitialized" class="setup-banner">
      Annotask not initialized — run <code>/annotask-init</code> in your AI assistant to set up project tokens and component detection.
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  showWarning: boolean
  configInitialized: boolean
}

defineProps<Props>()
</script>
