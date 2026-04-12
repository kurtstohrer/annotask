<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import NavBar from './components/NavBar.vue'

type Theme = 'dark' | 'light'

const STORAGE_KEY = 'storefront-theme'
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
  document.documentElement.setAttribute('data-theme', t)
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
  <div class="app">
    <NavBar :theme="theme" @toggle-theme="toggleTheme" />
    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root,
:root[data-theme="dark"] {
  --bg: #0b0e17;
  --surface: #141825;
  --surface-hover: #1c2133;
  --border: #2a2f42;
  --text: #e4e8f1;
  --text-dim: #7a8199;
  --accent: #5b8af5;
  --accent-dim: rgba(91, 138, 245, 0.15);
  --danger: #f55b5b;
  --success: #4ade80;
  --warning: #fbbf24;
  --radius: 8px;
}

:root[data-theme="light"] {
  --bg: #f5f6fa;
  --surface: #ffffff;
  --surface-hover: #eef0f7;
  --border: #d8dbe6;
  --text: #15172b;
  --text-dim: #5a607a;
  --accent: #4f46e5;
  --accent-dim: rgba(79, 70, 229, 0.10);
  --danger: #dc2626;
  --success: #16a34a;
  --warning: #d97706;
}

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.app { min-height: 100vh; }

.main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 20px;
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
