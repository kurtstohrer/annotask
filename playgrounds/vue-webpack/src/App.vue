<script setup lang="ts">
import Header from './components/Header.vue'
</script>

<template>
  <div class="app">
    <Header />
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0c1222;
  --surface: #131b2e;
  --surface-2: #1a2540;
  --border: #243049;
  --text: #e2e8f0;
  --text-muted: #64748b;
  --accent: #3b82f6;
}

html, body, #app { min-height: 100vh; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

.app { min-height: 100vh; }
.main-content { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
</style>
