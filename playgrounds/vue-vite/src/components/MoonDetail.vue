<script setup lang="ts">
import Card from 'primevue/card'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import type { Moon } from '../types'

const props = defineProps<{ moon: Moon }>()
const emit = defineEmits<{ close: [] }>()

function radiusPct(r: number): number {
  return Math.min((r / 2634) * 100, 100) // Ganymede as max reference
}

function lightenColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.min(r + 80, 255)}, ${Math.min(g + 80, 255)}, ${Math.min(b + 80, 255)})`
}

function darkenColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.max(r - 60, 0)}, ${Math.max(g - 60, 0)}, ${Math.max(b - 60, 0)})`
}
</script>

<template>
  <aside class="detail-panel">
    <Card class="detail-card">
      <template #header>
        <div class="detail-header">
          <div class="header-top">
            <div class="moon-icon" :style="{ background: `radial-gradient(circle at 35% 35%, ${lightenColor(moon.color)}, ${moon.color}, ${darkenColor(moon.color)})`, '--moon-glow': moon.color + '55' }"></div>
            <div class="header-info">
              <h2 class="moon-name">{{ moon.name }}</h2>
              <span class="planet-tag">
                <i class="pi pi-globe"></i>
                {{ moon.planet }}
              </span>
            </div>
            <Button
              icon="pi pi-times"
              text
              rounded
              size="small"
              class="close-btn"
              @click="emit('close')"
            />
          </div>
        </div>
      </template>

      <template #content>
        <p class="description">{{ moon.description }}</p>

        <div class="stat-group">
          <div class="stat-row">
            <div class="stat-meta">
              <span class="stat-label">Radius</span>
              <span class="stat-val">{{ moon.radius_km.toLocaleString() }} km</span>
            </div>
            <ProgressBar :value="radiusPct(moon.radius_km)" :showValue="false" class="stat-bar" />
          </div>
        </div>

        <div class="info-grid">
          <div class="info-item">
            <i class="pi pi-globe"></i>
            <div>
              <span class="info-label">Parent Planet</span>
              <span class="info-value">{{ moon.planet }}</span>
            </div>
          </div>
          <div class="info-item">
            <i class="pi pi-arrows-h"></i>
            <div>
              <span class="info-label">Orbit Distance</span>
              <span class="info-value">{{ moon.distance_km.toLocaleString() }} km</span>
            </div>
          </div>
          <div class="info-item">
            <i class="pi pi-replay"></i>
            <div>
              <span class="info-label">Orbital Period</span>
              <span class="info-value">{{ moon.orbital_period_days }} days</span>
            </div>
          </div>
          <div class="info-item">
            <i class="pi pi-calendar"></i>
            <div>
              <span class="info-label">Discovered</span>
              <span class="info-value">{{ moon.year_discovered ?? 'Ancient' }}</span>
            </div>
          </div>
        </div>

        <div v-if="moon.discovered_by" class="discovery">
          <i class="pi pi-user"></i>
          Discovered by <strong>{{ moon.discovered_by }}</strong>
        </div>
      </template>
    </Card>
  </aside>
</template>

<style scoped>
.detail-panel { width: 340px; flex-shrink: 0; align-self: stretch; }

.detail-card { border-radius: 12px; overflow: hidden; height: 100%; }

.detail-header { padding: 20px 20px 0; }

.header-top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.moon-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 12px var(--moon-glow, rgba(255,255,255,0.15));
}

.header-info { flex: 1; }

.moon-name {
  font-size: 20px;
  font-weight: 700;
  color: #f8fafc;
  margin-bottom: 4px;
}

.planet-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}

.planet-tag i { font-size: 11px; }

.close-btn { flex-shrink: 0; }

.description {
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
  margin-bottom: 20px;
}

.stat-group {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 20px;
}

.stat-row { display: flex; flex-direction: column; gap: 6px; }

.stat-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.stat-label {
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.stat-val {
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stat-bar { height: 6px; border-radius: 3px; }

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 20px;
}

.info-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.info-item i {
  color: var(--text-muted);
  font-size: 14px;
  margin-top: 2px;
}

.info-label {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 1px;
}

.info-value {
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.discovery {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  background: var(--surface-alt);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

.discovery i { color: var(--text-muted); }
.discovery strong { color: var(--text); }
</style>
