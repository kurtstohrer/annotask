<script setup lang="ts">
import NavBar from './components/NavBar.vue'
</script>

<template>
  <div class="app">
    <NavBar />
    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
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

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
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
