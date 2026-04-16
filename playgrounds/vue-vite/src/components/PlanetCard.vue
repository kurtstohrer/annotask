<script setup lang="ts">
import type { Planet } from '../types'

defineProps<{ planet: Planet; active?: boolean }>()
defineEmits<{ select: [planet: Planet] }>()
</script>

<template>
  <button
    class="planet-card"
    :class="{ active }"
    @click="$emit('select', planet)"
    :style="{ '--planet-color': planet.color } as any"
  >
    <span class="orb" :style="{ background: planet.color }"></span>
    <span class="body">
      <span class="name">{{ planet.name }}</span>
      <span class="type">{{ planet.type }}</span>
    </span>
    <span class="meta">
      <span class="moons">
        <i class="pi pi-circle-fill"></i>
        {{ planet.moons }} {{ planet.moons === 1 ? 'moon' : 'moons' }}
      </span>
      <span class="distance">{{ planet.distance_from_sun_mkm.toLocaleString() }} Mkm</span>
    </span>
  </button>
</template>

<style scoped>
.planet-card {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: border-color 0.15s, transform 0.15s, background 0.15s;
}

.planet-card:hover {
  background: var(--surface-alt);
  border-color: var(--planet-color);
  transform: translateY(-1px);
}

.planet-card.active {
  border-color: var(--planet-color);
  box-shadow: 0 0 0 1px var(--planet-color);
}

.orb {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  box-shadow: 0 0 18px color-mix(in srgb, var(--planet-color) 55%, transparent);
  border: 1px solid color-mix(in srgb, var(--planet-color) 30%, transparent);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name {
  font-size: 15px;
  font-weight: 600;
}

.type {
  font-size: 12px;
  color: var(--text-muted);
}

.meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.moons {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.moons i {
  font-size: 7px;
  color: var(--planet-color);
}
</style>
