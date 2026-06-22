<template>
  <div class="agents-panel">
    <AgentDirectionsPanel class="agents-panel-inner" />
  </div>
</template>

<script setup lang="ts">
import AgentDirectionsPanel from './AgentDirectionsPanel.vue'
</script>

<style scoped>
.agents-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  /* Let the panel fill the settings content area */
  height: 100%;
}

.agents-panel-inner {
  flex: 1;
  min-height: 400px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
</style>
