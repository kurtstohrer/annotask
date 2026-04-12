<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import Header from './components/Header.vue'

type Theme = 'dark' | 'light'

const STORAGE_KEY = 'annotask-admin-theme'
const theme = ref<Theme>('dark')

onMounted(() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') theme.value = stored
  } catch {
    /* noop */
  }
  applyTheme(theme.value)
})

function applyTheme(t: Theme) {
  const root = document.documentElement
  root.setAttribute('data-theme', t)
  if (t === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
  try {
    localStorage.setItem(STORAGE_KEY, t)
  } catch {
    /* noop */
  }
}

watch(theme, applyTheme)

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}
</script>

<template>
  <div class="app" :class="theme">
    <Header title="Annotask Admin" :theme="theme" @toggle-theme="toggleTheme" />

    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root,
:root[data-theme="dark"] {
  --bg: #121212;
  --surface: #1a1a1a;
  --surface-alt: #242424;
  --border: #333;
  --text: #e2e8f0;
  --text-muted: #888;
  --accent: #a0a0a0;
}

:root[data-theme="light"] {
  --bg: #f6f7fb;
  --surface: #ffffff;
  --surface-alt: #eef0f7;
  --border: #d8dbe6;
  --text: #15172b;
  --text-muted: #5a607a;
  --accent: #6366f1;
}

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.app { min-height: 100vh; }

.content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.view-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.p-selectbutton {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.p-selectbutton .p-togglebutton {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  padding: 3px 14px;
  gap: 6px;
  transition: all 0.15s;
}

.p-selectbutton .p-togglebutton .p-togglebutton-content {
  background: transparent;
}

.p-selectbutton .p-togglebutton.p-togglebutton-checked {
  background: var(--surface-alt);
  color: var(--text);
}

.layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

@media (max-width: 900px) {
  .layout { flex-direction: column; }
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  margin-bottom: 20px;
  background: color-mix(in srgb, #ef4444 12%, transparent);
  border: 1px solid color-mix(in srgb, #ef4444 30%, transparent);
  border-radius: 10px;
  color: #ef4444;
  font-size: 14px;
}

/* PrimeVue overrides — work in both themes via the var() system */
.p-datatable {
  background: var(--surface);
  border-radius: 10px;
  overflow: hidden;
}
.p-datatable-thead > tr > th {
  background: var(--surface-alt) !important;
  border-color: var(--border) !important;
  color: var(--text-muted) !important;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.p-datatable-tbody > tr {
  background: var(--surface) !important;
  border-color: var(--border) !important;
}
.p-datatable-tbody > tr:hover {
  background: var(--surface-alt) !important;
}
.p-datatable-tbody > tr > td {
  border-color: var(--border) !important;
  color: var(--text);
}
.p-inputtext {
  background: var(--surface-alt);
  border-color: var(--border);
  color: var(--text);
}
.p-inputtext:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
}
.p-card {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
}
.p-menubar {
  background: transparent;
  border: none;
}
.p-progressbar {
  background: var(--surface-alt);
  border-radius: 4px;
}
.p-progressbar-value {
  background: var(--accent);
}

/* Custom scrollbar */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
</style>
