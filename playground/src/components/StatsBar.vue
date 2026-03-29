<script setup lang="ts">
import type { Stats } from '../types'

defineProps<{ stats: Stats }>()
</script>

<template>
  <div class="stats-bar">
    <div class="stat-item">
      <span class="stat-value">{{ stats.total_planets }}</span>
      <span class="stat-label">Planets</span>
    </div>
    <div class="stat-divider"></div>
    <div class="stat-item">
      <span class="stat-value">{{ stats.total_moons }}</span>
      <span class="stat-label">Total Moons</span>
    </div>
    <div class="stat-divider"></div>
    <div class="stat-item">
      <span class="stat-value">{{ stats.largest_planet }}</span>
      <span class="stat-label">Largest</span>
    </div>
    <div class="stat-divider"></div>
    <div class="stat-item">
      <span class="stat-value">{{ stats.hottest_planet }}</span>
      <span class="stat-label">Hottest</span>
    </div>
    <div class="stat-divider"></div>
    <div class="stat-item">
      <span class="stat-value">{{ stats.coldest_planet }}</span>
      <span class="stat-label">Coldest</span>
    </div>
  </div>
</template>

<style scoped>
.stats-bar {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 12px 24px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.stat-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 0 20px;
}

.stat-item:first-child { padding-left: 0; }

.stat-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.stat-label {
  font-size: 12px;
  color: var(--text-muted);
}

.stat-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}
</style>
