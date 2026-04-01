<script setup lang="ts">
import { ref } from 'vue'

interface SunFact {
  label: string
  value: string
  icon: string
}

const facts = ref<SunFact[]>([
  { label: 'Type', value: 'G-type Main Sequence (G2V)', icon: 'pi pi-star' },
  { label: 'Age', value: '4.6 billion years', icon: 'pi pi-clock' },
  { label: 'Radius', value: '696,340 km', icon: 'pi pi-circle' },
  { label: 'Surface Temp', value: '5,500 \u00B0C', icon: 'pi pi-bolt' },
  { label: 'Core Temp', value: '15 million \u00B0C', icon: 'pi pi-bolt' },
  { label: 'Mass', value: '1.989 \u00D7 10\u00B3\u2070 kg', icon: 'pi pi-box' },
  { label: 'Composition', value: '73% Hydrogen, 25% Helium', icon: 'pi pi-chart-pie' },
  { label: 'Luminosity', value: '3.828 \u00D7 10\u00B2\u2076 W', icon: 'pi pi-sun' },
])

const layers = ref([
  { name: 'Core', depth: '0 \u2013 0.2 R\u2609', temp: '15 million \u00B0C', color: '#fff7cc' },
  { name: 'Radiative Zone', depth: '0.2 \u2013 0.7 R\u2609', temp: '7 million \u00B0C', color: '#ffe066' },
  { name: 'Convective Zone', depth: '0.7 \u2013 1.0 R\u2609', temp: '2 million \u00B0C', color: '#ffb833' },
  { name: 'Photosphere', depth: 'Surface', temp: '5,500 \u00B0C', color: '#ff9500' },
  { name: 'Chromosphere', depth: 'Lower Atmosphere', temp: '20,000 \u00B0C', color: '#ff5e3a' },
  { name: 'Corona', depth: 'Outer Atmosphere', temp: '1\u20132 million \u00B0C', color: '#e0e0e0' },
])
</script>

<template>
  <div class="sun-page">
    <div class="sun-intro">
      <div class="sun-hero">
        <div class="sun-title-block">
          <h2 class="sun-title">The Sun</h2>
          <p class="sun-subtitle">Our nearest star and the center of the Solar System</p>
        </div>
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
          <!-- Rays -->
          <g opacity="0.5">
            <line v-for="i in 12" :key="i"
              x1="100" y1="100"
              :x2="100 + 95 * Math.cos((i * 30) * Math.PI / 180)"
              :y2="100 + 95 * Math.sin((i * 30) * Math.PI / 180)"
              stroke="#ff9500" stroke-width="3" stroke-linecap="round" />
          </g>
          <!-- Sun body -->
          <circle cx="100" cy="100" r="60" fill="url(#sunGrad)" filter="url(#sunGlow)" />
          <!-- Inner highlight -->
          <circle cx="90" cy="88" r="20" fill="rgba(255,255,255,0.15)" />
        </svg>
      </div>

      <section class="description-section">
        <h3 class="section-title">About</h3>
        <p class="description-text">
          The Sun is the star at the center of our Solar System. It is a nearly perfect
          ball of hot plasma, heated to incandescence by nuclear fusion reactions in its
          core, radiating energy mainly as visible light, ultraviolet, and infrared radiation.
          It is by far the most important source of energy for life on Earth.
        </p>
        <p class="description-text">
          The Sun's gravity holds the Solar System together, keeping everything from the
          biggest planets to the smallest bits of debris in orbit around it. The connection
          and interactions between the Sun and Earth drive our planet's seasons, ocean
          currents, weather, climate, radiation belts, and auroras.
        </p>
      </section>
    </div>

    <div class="sun-content">

      <section class="facts-section">
        <h3 class="section-title">Key Facts</h3>
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

      <section class="layers-section">
        <h3 class="section-title">Solar Structure</h3>
        <div class="layers-list">
          <div v-for="layer in layers" :key="layer.name" class="layer-row">
            <div class="layer-dot" :style="{ background: layer.color }"></div>
            <div class="layer-info">
              <span class="layer-name">{{ layer.name }}</span>
              <span class="layer-depth">{{ layer.depth }}</span>
            </div>
            <span class="layer-temp">{{ layer.temp }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sun-page {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.sun-intro {
  display: flex;
  align-items: flex-start;
  gap: 32px;
  padding: 48px 32px 40px;
}

.sun-hero {
  flex-shrink: 0;
  text-align: left;
}

.sun-svg {
  width: 180px;
  height: 180px;
  margin: 0 0 0;
  display: block;
}

.sun-title-block {
  margin-bottom: 12px;
}

.sun-title {
  font-size: 32px;
  font-weight: 800;
  color: #f8fafc;
  margin: 0 0 4px;
  letter-spacing: -0.03em;
}

.sun-subtitle {
  font-size: 14px;
  color: #9ca3af;
  margin: 0;
}

.description-section {
  flex: 1;
  min-width: 0;
}

.sun-content {
  padding: 0 32px 40px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.section-title {
  font-size: 14px;
  font-weight: 700;
  color: #d1d5db;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 16px;
}

/* Facts grid */
.facts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
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

.fact-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fact-label {
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.fact-value {
  font-size: 14px;
  font-weight: 600;
  color: #f8fafc;
}

/* Layers */
.layers-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.layer-row + .layer-row {
  border-top: 1px solid var(--border);
}

.layer-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.layer-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
}

.layer-name {
  font-size: 13px;
  font-weight: 600;
  color: #f8fafc;
}

.layer-depth {
  font-size: 11px;
  color: #9ca3af;
}

.layer-temp {
  font-size: 13px;
  font-weight: 500;
  color: #ff9500;
  font-variant-numeric: tabular-nums;
}

/* Description */
.description-text {
  font-size: 14px;
  line-height: 1.7;
  color: #d1d5db;
  margin: 0 0 12px;
}

.description-text:last-child {
  margin-bottom: 0;
}
</style>
