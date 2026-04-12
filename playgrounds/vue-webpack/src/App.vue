<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import Header from './components/Header.vue'

type Theme = 'dark' | 'light'

const STORAGE_KEY = 'earth-theme'
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
    <Header :theme="theme" @toggle-theme="toggleTheme" />
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root,
:root[data-theme="dark"] {
  --bg: #0c1222;
  --surface: #131b2e;
  --surface-2: #1a2540;
  --border: #243049;
  --text: #e2e8f0;
  --text-muted: #64748b;
  --accent: #3b82f6;
}

:root[data-theme="light"] {
  --bg: #f5f7fb;
  --surface: #ffffff;
  --surface-2: #eef1f7;
  --border: #d8dce6;
  --text: #15172b;
  --text-muted: #5a607a;
  --accent: #2563eb;
}

html, body, #app {
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.app { min-height: 100vh; }
.main-content { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
</style>
