<script setup lang="ts">
import type { Ocean } from '../data'
defineProps<{ ocean: Ocean }>()
</script>

<template>
  <div class="ocean-card">
    <div class="card-accent" :style="{ background: ocean.color }" />
    <div class="card-body">
      <h3 class="card-title">{{ ocean.name }}</h3>
      <p class="card-desc">{{ ocean.description }}</p>
      <div class="card-stats">
        <div class="stat">
          <span class="stat-value">{{ ocean.area }}M</span>
          <span class="stat-label">km²</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ ocean.avgDepth.toLocaleString() }}m</span>
          <span class="stat-label">avg depth</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ ocean.maxDepth.toLocaleString() }}m</span>
          <span class="stat-label">max depth</span>
        </div>
      </div>
      <div class="card-deep">
        <span class="deep-label">Deepest:</span>
        <span class="deep-name">{{ ocean.deepestPoint }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ocean-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  transition: transform 0.15s, box-shadow 0.15s;
}
.ocean-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}
.card-accent { height: 4px; }
.card-body { padding: 20px; }
.card-title { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
.card-desc { font-size: 13px; color: var(--text-muted); line-height: 1.6; margin-bottom: 16px; }
.card-stats { display: flex; gap: 20px; margin-bottom: 14px; }
.stat { display: flex; flex-direction: column; }
.stat-value { font-size: 18px; font-weight: 700; }
.stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.card-deep {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; background: var(--surface-2); border-radius: 6px; font-size: 12px;
}
.deep-label { color: var(--text-muted); }
.deep-name { font-weight: 600; }
</style>
