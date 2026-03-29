<script setup lang="ts">
import Header from './components/Header.vue'
</script>

<template>
  <div class="app dark">
    <Header title="Solar System Explorer" />

    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #121212;
  --surface: #1a1a1a;
  --surface-alt: #242424;
  --border: #333;
  --text: #e2e8f0;
  --text-muted: #888;
  --accent: #a0a0a0;
}

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
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

.dark .p-selectbutton {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.dark .p-selectbutton .p-togglebutton {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  padding: 3px 14px;
  gap: 6px;
  transition: all 0.15s;
}

.dark .p-selectbutton .p-togglebutton .p-togglebutton-content {
  background: transparent;
}

.dark .p-selectbutton .p-togglebutton.p-togglebutton-checked {
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
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 10px;
  color: #fca5a5;
  font-size: 14px;
}

/* PrimeVue dark overrides for consistency */
.dark .p-datatable {
  background: var(--surface);
  border-radius: 10px;
  overflow: hidden;
}
.dark .p-datatable-thead > tr > th {
  background: var(--surface-alt) !important;
  border-color: var(--border) !important;
  color: var(--text-muted) !important;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.dark .p-datatable-tbody > tr {
  background: var(--surface) !important;
  border-color: var(--border) !important;
}
.dark .p-datatable-tbody > tr:hover {
  background: var(--surface-alt) !important;
}
.dark .p-datatable-tbody > tr > td {
  border-color: var(--border) !important;
  color: var(--text);
}
.dark .p-inputtext {
  background: var(--surface-alt);
  border-color: var(--border);
  color: var(--text);
}
.dark .p-inputtext:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(160, 160, 160, 0.15);
}
.dark .p-card {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
}
.dark .p-menubar {
  background: transparent;
  border: none;
}
.dark .p-progressbar {
  background: var(--surface-alt);
  border-radius: 4px;
}
.dark .p-progressbar-value {
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
