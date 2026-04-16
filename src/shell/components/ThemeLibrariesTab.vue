<script setup lang="ts">
import type { AnnotaskDesignSpec } from '../../schema'

defineProps<{
  designSpec: AnnotaskDesignSpec | null
}>()
</script>

<template>
  <div class="theme-section">
    <h4 class="section-subtitle">Icons</h4>
    <div v-if="!designSpec?.icons" class="theme-section-empty">No icon library detected</div>
    <div v-else class="library-card">
      <span class="library-name">{{ designSpec.icons.library }}</span>
      <span v-if="designSpec.icons.version" class="library-version">v{{ designSpec.icons.version }}</span>
    </div>

    <h4 class="section-subtitle" style="margin-top: 16px">Components</h4>
    <div v-if="!designSpec?.components" class="theme-section-empty">No component library detected</div>
    <template v-else>
      <div class="library-card">
        <span class="library-name">{{ designSpec.components.library }}</span>
        <span v-if="designSpec.components.version" class="library-version">v{{ designSpec.components.version }}</span>
      </div>
      <div v-if="designSpec.components.used?.length" class="library-components">
        <span v-for="c in designSpec.components.used" :key="c" class="component-chip">{{ c }}</span>
      </div>
    </template>

    <h4 class="section-subtitle" style="margin-top: 16px">Framework</h4>
    <div v-if="designSpec?.framework" class="library-card">
      <span class="library-name">{{ designSpec.framework.name }}</span>
      <span class="library-version">v{{ designSpec.framework.version }}</span>
      <span v-for="s in designSpec.framework.styling" :key="s" class="styling-chip">{{ s }}</span>
    </div>
  </div>
</template>

<style scoped>
.theme-section { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.theme-section-empty { font-size: 11px; color: var(--text-muted); padding: 8px 0; font-style: italic; }
.section-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0; }

.library-card {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface-2);
}
.library-name { font-size: 12px; font-weight: 600; color: var(--text); }
.library-version { font-size: 11px; color: var(--text-muted); font-family: ui-monospace, monospace; }
.library-components { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.component-chip {
  font-size: 10px; padding: 2px 6px; border-radius: 3px;
  background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
}
.styling-chip {
  font-size: 10px; padding: 1px 5px; border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent); font-weight: 600;
}
</style>
