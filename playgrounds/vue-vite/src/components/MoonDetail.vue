<script setup lang="ts">
import type { Moon } from '../types'

defineProps<{ moon: Moon }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <aside class="moon-detail" :style="{ '--moon-color': moon.color } as any">
    <header class="detail-head">
      <div class="title-row">
        <span class="orb" :style="{ background: moon.color }"></span>
        <div class="titles">
          <h2>{{ moon.name }}</h2>
          <span class="planet-pill">Orbits {{ moon.planet }}</span>
        </div>
      </div>
      <button class="close" @click="$emit('close')" aria-label="Close">
        <i class="pi pi-times"></i>
      </button>
    </header>

    <p class="description">{{ moon.description }}</p>

    <dl class="facts">
      <div>
        <dt>Radius</dt>
        <dd>{{ moon.radius_km.toLocaleString() }} km</dd>
      </div>
      <div>
        <dt>Orbital Distance</dt>
        <dd>{{ moon.distance_km.toLocaleString() }} km</dd>
      </div>
      <div>
        <dt>Orbital Period</dt>
        <dd>{{ moon.orbital_period_days }} days</dd>
      </div>
      <div v-if="moon.discovered_by">
        <dt>Discovered By</dt>
        <dd>{{ moon.discovered_by }}</dd>
      </div>
      <div v-if="moon.year_discovered">
        <dt>Year</dt>
        <dd>{{ moon.year_discovered }}</dd>
      </div>
    </dl>
  </aside>
</template>

<style scoped>
.moon-detail {
  flex: 0 0 340px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  position: sticky;
  top: 20px;
}

.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.title-row {
  display: flex;
  gap: 14px;
  align-items: center;
}

.orb {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  box-shadow: 0 0 18px color-mix(in srgb, var(--moon-color) 55%, transparent);
  border: 1px solid color-mix(in srgb, var(--moon-color) 30%, transparent);
}

.titles h2 {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: 4px;
}

.planet-pill {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--surface-alt);
  color: var(--text-muted);
  border: 1px solid var(--border);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
  padding: 4px 6px;
  border-radius: 6px;
}

.close:hover {
  background: var(--surface-alt);
  color: var(--text);
}

.description {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-muted);
}

.facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 20px;
}

.facts div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.facts dt {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.facts dd {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
</style>
