<script setup lang="ts">
import { continents, oceans } from '../data'

const totalLandArea = continents.reduce((s, c) => s + c.area, 0).toFixed(1)
const totalOceanArea = oceans.reduce((s, o) => s + o.area, 0).toFixed(1)
const totalPopulation = continents.reduce((s, c) => s + c.population, 0).toFixed(2)
const totalCountries = continents.reduce((s, c) => s + c.countries, 0)
const deepestOcean = oceans.reduce((a, b) => a.maxDepth > b.maxDepth ? a : b)
const largestContinent = continents.reduce((a, b) => a.area > b.area ? a : b)
const largestOcean = oceans.reduce((a, b) => a.area > b.area ? a : b)
</script>

<template>
  <div class="overview-page">
    <div class="page-header">
      <h1 class="page-title">Earth Overview</h1>
      <p class="page-subtitle">Key statistics about our planet's land and water</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">🌍</div>
        <div class="stat-info">
          <div class="stat-value">510.1M km²</div>
          <div class="stat-label">Total Surface Area</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🏔️</div>
        <div class="stat-info">
          <div class="stat-value">{{ totalLandArea }}M km²</div>
          <div class="stat-label">Total Land Area</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🌊</div>
        <div class="stat-info">
          <div class="stat-value">{{ totalOceanArea }}M km²</div>
          <div class="stat-label">Total Ocean Area</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">👥</div>
        <div class="stat-info">
          <div class="stat-value">{{ totalPopulation }}B</div>
          <div class="stat-label">World Population</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🏳️</div>
        <div class="stat-info">
          <div class="stat-value">{{ totalCountries }}</div>
          <div class="stat-label">Countries</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🏔️</div>
        <div class="stat-info">
          <div class="stat-value">8,849 m</div>
          <div class="stat-label">Highest Point (Everest)</div>
        </div>
      </div>
    </div>

    <div class="records-section">
      <h2 class="section-title">Records</h2>
      <div class="records-grid">
        <div class="record-card">
          <div class="record-label">Largest Continent</div>
          <div class="record-value">{{ largestContinent.name }}</div>
          <div class="record-detail">{{ largestContinent.area }}M km²</div>
        </div>
        <div class="record-card">
          <div class="record-label">Largest Ocean</div>
          <div class="record-value">{{ largestOcean.name }}</div>
          <div class="record-detail">{{ largestOcean.area }}M km²</div>
        </div>
        <div class="record-card">
          <div class="record-label">Deepest Point</div>
          <div class="record-value">{{ deepestOcean.deepestPoint }}</div>
          <div class="record-detail">{{ deepestOcean.maxDepth.toLocaleString() }} m in {{ deepestOcean.name }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-header { margin-bottom: 32px; }
.page-title { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
.page-subtitle { font-size: 15px; color: var(--text-muted); }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 40px; }
.stat-card {
  display: flex; align-items: center; gap: 14px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px;
}
.stat-icon { font-size: 28px; }
.stat-value { font-size: 20px; font-weight: 700; }
.stat-label { font-size: 12px; color: var(--text-muted); }
.records-section { margin-top: 16px; }
.section-title { font-size: 20px; font-weight: 700; margin-bottom: 16px; }
.records-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.record-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px;
}
.record-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
.record-value { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
.record-detail { font-size: 13px; color: var(--text-muted); }
</style>
