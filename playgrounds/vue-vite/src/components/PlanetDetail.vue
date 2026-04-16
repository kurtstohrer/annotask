<script setup lang="ts">
import type { Planet } from '../types'

defineProps<{ planet: Planet }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <aside class="planet-detail" :style="{ '--planet-color': planet.color } as any">
    <header class="detail-head">
      <div class="title-row">
        <span class="orb" :style="{ background: planet.color }"></span>
        <div class="titles">
          <h2>{{ planet.name }}</h2>
          <span class="type-pill">{{ planet.type }}</span>
        </div>
      </div>
      <button class="close" @click="$emit('close')" aria-label="Close">
        <i class="pi pi-times"></i>
      </button>
    </header>

    <p class="description">{{ planet.description }}</p>

    <dl class="facts">
      <div>
        <dt>Radius</dt>
        <dd>{{ planet.radius_km.toLocaleString() }} km</dd>
      </div>
      <div>
        <dt>Gravity</dt>
        <dd>{{ planet.gravity_ms2 }} m/s²</dd>
      </div>
      <div>
        <dt>Avg. Temp</dt>
        <dd>{{ planet.avg_temp_c }} °C</dd>
      </div>
      <div>
        <dt>Moons</dt>
        <dd>{{ planet.moons }}</dd>
      </div>
      <div>
        <dt>Distance from Sun</dt>
        <dd>{{ planet.distance_from_sun_mkm.toLocaleString() }} Mkm</dd>
      </div>
      <div>
        <dt>Orbital Period</dt>
        <dd>{{ planet.orbital_period_days.toLocaleString() }} days</dd>
      </div>
      <div>
        <dt>Day Length</dt>
        <dd>{{ planet.day_length_hours }} h</dd>
      </div>
      <div v-if="planet.discovered_by">
        <dt>Discovered By</dt>
        <dd>{{ planet.discovered_by }}</dd>
      </div>
    </dl>
  </aside>
</template>

<style scoped>
.planet-detail {
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
  width: 44px;
  height: 44px;
  border-radius: 50%;
  box-shadow: 0 0 24px color-mix(in srgb, var(--planet-color) 55%, transparent);
  border: 1px solid color-mix(in srgb, var(--planet-color) 35%, transparent);
}

.titles h2 {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: 4px;
}

.type-pill {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--planet-color) 14%, transparent);
  color: var(--planet-color);
  border: 1px solid color-mix(in srgb, var(--planet-color) 30%, transparent);
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
