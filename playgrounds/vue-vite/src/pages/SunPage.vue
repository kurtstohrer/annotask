<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Sun } from '../types'

const sun = ref<Sun | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/api/solar/sun')
    if (!res.ok) throw new Error('api')
    sun.value = await res.json()
  } catch {
    error.value = 'Failed to load Sun data — is the API running on port 8888?'
  }
})

const facts = computed(() => {
  if (!sun.value) return []
  const s = sun.value
  return [
    { label: 'Type', value: s.type, icon: 'pi pi-star' },
    { label: 'Age', value: `${(s.age_years / 1e9).toFixed(1)} billion years`, icon: 'pi pi-clock' },
    { label: 'Radius', value: `${s.radius_km.toLocaleString()} km`, icon: 'pi pi-circle' },
    { label: 'Surface Temp', value: `${s.surface_temp_c.toLocaleString()} °C`, icon: 'pi pi-bolt' },
    { label: 'Core Temp', value: `${(s.core_temp_c / 1e6).toFixed(0)} million °C`, icon: 'pi pi-bolt' },
    { label: 'Mass', value: `${s.mass_kg.toExponential(3)} kg`, icon: 'pi pi-box' },
    {
      label: 'Composition',
      value: `${s.composition.hydrogen_pct}% H, ${s.composition.helium_pct}% He`,
      icon: 'pi pi-chart-pie',
    },
    { label: 'Luminosity', value: `${s.luminosity_w.toExponential(3)} W`, icon: 'pi pi-sun' },
  ]
})
</script>

<template>
  <section class="sun-page">
    <p v-if="error" class="error-banner">{{ error }}</p>

    <div class="sun-intro">
      <div class="sun-hero">
        <svg class="sun-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="sunGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#fff7cc" />
              <stop offset="30%" stop-color="#ffe066" />
              <stop offset="60%" stop-color="#ffb833" />
              <stop offset="80%" stop-color="#ff9500" />
              <stop offset="100%" stop-color="#ff5e3a" />
            </radialGradient>
            <filter id="sunGlow">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g opacity="0.5">
            <line
              v-for="i in 12"
              :key="i"
              x1="100"
              y1="100"
              :x2="100 + 95 * Math.cos((i * 30) * Math.PI / 180)"
              :y2="100 + 95 * Math.sin((i * 30) * Math.PI / 180)"
              stroke="#ff9500"
              stroke-width="3"
              stroke-linecap="round"
            />
          </g>
          <circle cx="100" cy="100" r="60" fill="url(#sunGrad)" filter="url(#sunGlow)" />
          <circle cx="90" cy="88" r="20" fill="rgba(255,255,255,0.15)" />
        </svg>
      </div>

      <div class="intro-body">
        <h1 class="sun-title">The Sun</h1>
        <p class="sun-subtitle">Our nearest star and the center of the Solar System.</p>
        <p class="sun-lede">
          The Sun is a nearly perfect ball of hot plasma, heated to incandescence by nuclear
          fusion in its core. It provides the energy that drives Earth's climate, weather,
          and biosphere — and its gravity keeps every planet, moon, and dust grain in the
          Solar System in orbit.
        </p>
      </div>
    </div>

    <section class="facts-section">
      <h2 class="section-title">Key facts</h2>
      <div class="facts-grid">
        <div v-for="fact in facts" :key="fact.label" class="fact-card">
          <i :class="fact.icon" class="fact-icon"></i>
          <div class="fact-body">
            <span class="fact-label">{{ fact.label }}</span>
            <span class="fact-value">{{ fact.value }}</span>
          </div>
        </div>
      </div>
    </section>

    <section v-if="sun" class="layers-section">
      <h2 class="section-title">Solar structure</h2>
      <div class="layers-list">
        <div v-for="layer in sun.layers" :key="layer.name" class="layer-row">
          <div class="layer-dot" :style="{ background: layer.color }"></div>
          <div class="layer-info">
            <span class="layer-name">{{ layer.name }}</span>
            <span class="layer-depth">{{ layer.depth }}</span>
          </div>
          <span class="layer-temp">{{ layer.temp }}</span>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.sun-page { display: flex; flex-direction: column; gap: 28px; }

.sun-intro {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 20px 0;
}

.sun-hero { flex-shrink: 0; }
.sun-svg { width: 180px; height: 180px; display: block; }

.intro-body { flex: 1; min-width: 0; }

.sun-title {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--text);
}

.sun-subtitle {
  font-size: 14px;
  color: var(--text-muted);
  margin: 4px 0 14px;
}

.sun-lede {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text);
  max-width: 640px;
}

.section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.facts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.fact-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.fact-icon {
  font-size: 16px;
  color: #ff9500;
  flex-shrink: 0;
}

.fact-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

.fact-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.fact-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  word-wrap: break-word;
}

.layers-list {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-top: 1px solid var(--border);
}

.layer-row:first-child { border-top: none; }

.layer-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-shadow: 0 0 10px currentColor;
  flex-shrink: 0;
}

.layer-info { flex: 1; display: flex; flex-direction: column; gap: 1px; }
.layer-name { font-size: 14px; font-weight: 600; color: var(--text); }
.layer-depth { font-size: 12px; color: var(--text-muted); }

.layer-temp {
  font-size: 13px;
  font-weight: 600;
  color: #ff9500;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 700px) {
  .sun-intro { flex-direction: column; text-align: center; gap: 16px; }
  .sun-lede { text-align: left; }
  .sun-title { font-size: 26px; }
}
</style>
