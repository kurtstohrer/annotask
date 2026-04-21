<script setup lang="ts">
import { useRoute } from 'vue-router'
const route = useRoute()

defineProps<{ theme: 'dark' | 'light' }>()
defineEmits<{ 'toggle-theme': [] }>()
</script>

<template>
  <header class="earth-header">
    <div class="header-inner">
      <div class="header-brand">
        <span class="earth-icon">🌍</span>
        <span class="brand-text">Earth Explorer</span>
      </div>
      <nav class="header-nav">
        <router-link to="/continents" :class="['nav-link', { active: route.path === '/continents' }]">Continents</router-link>
        <router-link to="/oceans" :class="['nav-link', { active: route.path === '/oceans' }]">Oceans</router-link>
        <router-link to="/overview" :class="['nav-link', { active: route.path === '/overview' }]">Overview</router-link>
        <button
          class="theme-toggle"
          @click="$emit('toggle-theme')"
          :aria-label="`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`"
        >
          {{ theme === 'dark' ? '☀' : '☾' }}
        </button>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.earth-header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 0 24px;
}
.header-inner {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
}
.header-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.earth-icon { font-size: 24px; }
.brand-text { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
.header-nav { display: flex; gap: 4px; }
.nav-link {
  padding: 6px 14px;
  border-radius: 6px;
  color: var(--text-muted);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s;
}
.nav-link:hover { color: var(--text); background: var(--surface-2); }
.nav-link.active { color: white; background: var(--accent); }

.theme-toggle {
  width: 30px;
  height: 30px;
  margin-left: 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.theme-toggle:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
