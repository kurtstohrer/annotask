<script setup lang="ts">
import { continents } from '../data'
import ContinentCard from '../components/ContinentCard.vue'
import WorldMap from '../components/WorldMap.vue'
</script>

<template>
  <div class="continents-page">
    <WorldMap />
    <div class="page-header">
      <h1 class="page-title">Continents</h1>
      <p class="page-subtitle">The seven major landmasses of Earth, covering 29% of the planet's surface</p>
    </div>
    <div class="card-grid">
      <ContinentCard v-for="c in continents" :key="c.name" :continent="c" />
    </div>
  </div>
</template>

<style scoped>
.page-header { margin-bottom: 32px; }
.page-title { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
.page-subtitle { font-size: 15px; color: var(--text-muted); }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px; }
</style>
