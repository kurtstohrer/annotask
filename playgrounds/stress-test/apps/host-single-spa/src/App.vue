<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

interface Mfe {
  id: string
  label: string
  stack: string
  hash: string
  mountId: string
}

const mfes: Mfe[] = [
  { id: 'vue-data-lab',        label: 'Vue · Data Lab',        stack: 'Vue + FastAPI + Naive UI', hash: '#/vue',    mountId: 'single-spa-application:@stress/vue-data-lab' },
  { id: 'react-workflows',     label: 'React · Workflows',     stack: 'React + Java + Mantine',   hash: '#/react',  mountId: 'single-spa-application:@stress/react-workflows' },
  { id: 'svelte-streaming',    label: 'Svelte · Streaming',    stack: 'Svelte + Go + bits-ui',    hash: '#/svelte', mountId: 'single-spa-application:@stress/svelte-streaming' },
  { id: 'solid-component-lab', label: 'Solid · Component Lab', stack: 'Solid + Node + Kobalte',   hash: '#/solid',  mountId: 'single-spa-application:@stress/solid-component-lab' },
  { id: 'blade-legacy-lab',    label: 'Blade · Legacy Lab',    stack: 'Blade + Laravel (iframe)', hash: '#/blade',  mountId: 'single-spa-application:@stress/blade-legacy-lab' },
  { id: 'htmx-partials',       label: 'htmx · Partials',       stack: 'htmx + Rust + Pico.css',   hash: '#/htmx',   mountId: 'single-spa-application:@stress/htmx-partials' },
]

const currentHash = ref(window.location.hash || '#/')
function onHashChange() {
  currentHash.value = window.location.hash || '#/'
}

onMounted(() => window.addEventListener('hashchange', onHashChange))
onUnmounted(() => window.removeEventListener('hashchange', onHashChange))

const isHome = computed(() => currentHash.value === '#/' || currentHash.value === '')
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="#/">Annotask Stress Lab</a>
      <nav class="nav">
        <a
          v-for="mfe in mfes"
          :key="mfe.hash"
          :href="mfe.hash"
          class="nav-btn"
          :class="{ active: currentHash === mfe.hash }"
        >
          {{ mfe.label }}
        </a>
      </nav>
    </header>

    <main class="main">
      <section v-show="isHome" class="overview">
        <h1>Host (single-spa root)</h1>
        <p>
          Each nav link routes to a different child MFE mounted via
          <code>single-spa</code> — no iframes for the JS stacks. The Blade slot
          still uses an iframe because Laravel serves a full cross-origin SSR
          page (a supported single-spa legacy pattern).
        </p>
        <p>
          Every MFE has its own Vite dev server. The host imports each MFE's
          <code>src/single-spa.*</code> module over HTTP and registers it. Click
          any tab to route there; the mount point below receives the rendered
          output.
        </p>

        <table class="grid">
          <thead>
            <tr><th>MFE</th><th>Stack</th><th>Route</th></tr>
          </thead>
          <tbody>
            <tr v-for="mfe in mfes" :key="mfe.id">
              <td>{{ mfe.label }}</td>
              <td>{{ mfe.stack }}</td>
              <td><code>{{ mfe.hash }}</code></td>
            </tr>
          </tbody>
        </table>
      </section>

      <div v-show="!isHome" class="viewport">
        <div
          v-for="mfe in mfes"
          :key="mfe.mountId"
          :id="mfe.mountId"
          class="mfe-mount"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.shell { display: flex; flex-direction: column; min-height: 100vh; font-family: var(--stress-font); color: #e8ecf1; background: #0b0f17; }
.topbar { display: flex; align-items: center; gap: 16px; padding: 12px 20px; border-bottom: 1px solid #1e2836; background: #0f1623; position: sticky; top: 0; z-index: 1; }
.brand { font-weight: 600; font-size: 15px; color: inherit; text-decoration: none; }
.nav { display: flex; flex-wrap: wrap; gap: 6px; }
.nav-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid #24314a; border-radius: 999px; background: transparent; color: #bac5d4; font-size: 13px; text-decoration: none; }
.nav-btn:hover { border-color: #3c5170; color: #e8ecf1; }
.nav-btn.active { background: var(--stress-accent); border-color: var(--stress-accent); color: #fff; }
.main { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.overview { padding: 32px 28px; max-width: 880px; line-height: 1.55; }
.overview h1 { margin: 0 0 12px; font-size: 22px; }
.grid { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
.grid th, .grid td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #1e2836; }
.grid th { color: #8793a6; font-weight: 500; }
.viewport { flex: 1; background: var(--stress-bg); min-height: 0; color: var(--stress-text); }
.mfe-mount { min-height: 0; }
code { font-family: var(--stress-font-mono); font-size: 12px; color: #c6d1e1; }
</style>
