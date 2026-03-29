<script setup lang="ts">
import { oceans } from '../data'
import OceanCard from '../components/OceanCard.vue'
</script>

<template>
  <div class="oceans-page">
    <div class="page-header">
      <h1 class="page-title">Oceans</h1>
      <p class="page-subtitle">The five bodies of water covering 71% of Earth's surface</p>
    </div>
    <div class="card-grid">
      <OceanCard v-for="o in oceans" :key="o.name" :ocean="o" />
    </div>
  </div>
</template>

<style scoped>
.page-header { margin-bottom: 32px; }
.page-title { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
.page-subtitle { font-size: 15px; color: var(--text-muted); }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px; }
</style>
