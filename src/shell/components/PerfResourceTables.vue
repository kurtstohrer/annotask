<script setup lang="ts">
import { ref } from 'vue'
import type { PackageGroup } from '../composables/usePerfMonitor'

const props = defineProps<{
  /** Raw performance resource entries (from scan or recording). */
  resources: Array<{ name: string; initiatorType: string; transferSize: number; duration: number }>
  /** Grouped-by-npm-package view of `resources`. */
  packageGroups: PackageGroup[]
}>()

const showResources = ref(false)
const showPackages = ref(false)

function isHeavy(r: { initiatorType: string; transferSize: number }): boolean {
  const threshold: Record<string, number> = { script: 200 * 1024, img: 500 * 1024, css: 100 * 1024 }
  return r.transferSize > (threshold[r.initiatorType] ?? 500 * 1024)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
}

function formatMs(ms: number): string {
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's'
  return Math.round(ms) + 'ms'
}

function shortenUrl(url: string): string {
  try { const p = new URL(url).pathname; return p.length > 50 ? '...' + p.slice(-47) : p }
  catch { return url.length > 50 ? '...' + url.slice(-47) : url }
}
</script>

<template>
  <div v-if="props.packageGroups.length > 0" class="collapsible-section">
    <button class="collapse-toggle" @click="showPackages = !showPackages">
      <svg :class="{ rotated: showPackages }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      Packages ({{ props.packageGroups.length }})
    </button>
    <div v-if="showPackages" class="resource-table">
      <div class="resource-header">
        <span class="res-name">Package</span>
        <span class="res-type">Modules</span>
        <span class="res-size">Size</span>
        <span class="res-dur">Alt?</span>
      </div>
      <div v-for="(pkg, i) in props.packageGroups.slice(0, 30)" :key="i"
           class="resource-row" :class="{ heavy: pkg.totalSize > 100 * 1024 }">
        <span class="res-name" :title="pkg.name">{{ pkg.name }}</span>
        <span class="res-type">{{ pkg.modules }}</span>
        <span class="res-size">{{ formatBytes(pkg.totalSize) }}</span>
        <span class="res-dur pkg-alt" :title="pkg.alternative || ''">{{ pkg.alternative ? 'Yes' : '' }}</span>
      </div>
    </div>
  </div>

  <div v-if="props.resources.length > 0" class="collapsible-section">
    <button class="collapse-toggle" @click="showResources = !showResources">
      <svg :class="{ rotated: showResources }" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      Resources ({{ props.resources.length }})
    </button>
    <div v-if="showResources" class="resource-table">
      <div class="resource-header">
        <span class="res-name">URL</span>
        <span class="res-type">Type</span>
        <span class="res-size">Size</span>
        <span class="res-dur">Duration</span>
      </div>
      <div v-for="(r, i) in props.resources.slice(0, 50)" :key="i"
           class="resource-row" :class="{ heavy: isHeavy(r) }">
        <span class="res-name" :title="r.name">{{ shortenUrl(r.name) }}</span>
        <span class="res-type">{{ r.initiatorType }}</span>
        <span class="res-size">{{ formatBytes(r.transferSize) }}</span>
        <span class="res-dur">{{ formatMs(r.duration) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.collapsible-section { border-top: 1px solid var(--border); padding-top: 6px; }
.collapse-toggle { display: flex; align-items: center; gap: 4px; background: none; border: none; cursor: pointer; font-size: 10px; font-weight: 600; color: var(--text-muted); padding: 2px 0; }
.collapse-toggle:hover { color: var(--text); }
.collapse-toggle svg { transition: transform 0.15s; }
.collapse-toggle svg.rotated { transform: rotate(90deg); }

.resource-table { margin-top: 6px; font-size: 10px; }
.resource-header, .resource-row { display: grid; grid-template-columns: 1fr 60px 60px 60px; gap: 4px; padding: 3px 0; }
.resource-header { font-weight: 700; color: var(--text-muted); border-bottom: 1px solid var(--border); text-transform: uppercase; font-size: 9px; }
.resource-row { color: var(--text); border-bottom: 1px solid rgba(255,255,255,0.04); }
.resource-row.heavy { color: var(--warning); }
.res-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.res-type { color: var(--text-muted); }
.res-size { text-align: right; }
.res-dur { text-align: right; color: var(--text-muted); }
.pkg-alt { color: var(--warning); font-weight: 600; cursor: help; }
</style>
