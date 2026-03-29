<script setup lang="ts">
import type { Continent } from '../data'
defineProps<{ continent: Continent }>()
</script>

<template>
  <div class="continent-card">
    <div class="card-accent" :style="{ background: continent.color }" />
    <div class="card-body">
      <h3 class="card-title">{{ continent.name }}</h3>
      <p class="card-desc">{{ continent.description }}</p>
      <div class="card-stats">
        <div class="stat">
          <span class="stat-value">{{ continent.area }}M</span>
          <span class="stat-label">km²</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ continent.population > 0 ? continent.population + 'B' : '—' }}</span>
          <span class="stat-label">people</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ continent.countries || '—' }}</span>
          <span class="stat-label">countries</span>
        </div>
      </div>
      <div class="card-peak">
        <span class="peak-label">Highest:</span>
        <span class="peak-name">{{ continent.highestPoint }}</span>
        <span class="peak-elev">{{ continent.highestElevation }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.continent-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  transition: transform 0.15s, box-shadow 0.15s;
}
.continent-card:hover {
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
.card-peak {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; background: var(--surface-2); border-radius: 6px; font-size: 12px;
}
.peak-label { color: var(--text-muted); }
.peak-name { font-weight: 600; }
.peak-elev { color: var(--text-muted); margin-left: auto; }
</style>
