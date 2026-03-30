<template>
  <div class="ranking">
    <div v-for="planet in sorted" :key="planet.id" class="rank-row">
      <div class="rank-dot" :style="{ background: planet.color }"></div>
      <span class="rank-name">{{ planet.name }}</span>
      <div class="rank-bar-track">
        <div class="rank-bar" :style="{ width: pct(planet) + '%', background: planet.color }"></div>
      </div>
      <span class="rank-value">{{ planet.radius_km.toLocaleString() }} km</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Planet } from '../types'

const props = defineProps<{ planets: Planet[] }>()

const sorted = computed(() => [...props.planets].sort((a, b) => b.radius_km - a.radius_km))
const maxRadius = computed(() => sorted.value[0]?.radius_km || 1)
function pct(p: Planet) { return (p.radius_km / maxRadius.value) * 100 }
</script>

<style scoped>
.ranking { display: flex; flex-direction: column; gap: 8px; }
.rank-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.rank-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.rank-name {
  width: 80px;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}
.rank-bar-track {
  flex: 1;
  height: 6px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}
.rank-bar {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}
.rank-value {
  font-size: 12px;
  color: var(--text-dim);
  width: 90px;
  text-align: right;
  flex-shrink: 0;
}
</style>
