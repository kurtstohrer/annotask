<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

interface Mfe {
  id: string
  label: string
  stack: string
  hash: string
  mountId: string
}

const contentMfes: Mfe[] = [
  { id: 'vue-data-lab',        label: 'Vue · Data Lab',        stack: 'Vue + FastAPI + Naive UI',      hash: '#/vue',    mountId: 'single-spa-application:@stress/vue-data-lab' },
  { id: 'react-workflows',     label: 'React · Workflows',     stack: 'React + Java + Mantine',        hash: '#/react',  mountId: 'single-spa-application:@stress/react-workflows' },
  { id: 'svelte-streaming',    label: 'Svelte · Streaming',    stack: 'Svelte + Go + bits-ui',         hash: '#/svelte', mountId: 'single-spa-application:@stress/svelte-streaming' },
  { id: 'solid-component-lab', label: 'Solid · Component Lab', stack: 'Solid + Node + Kobalte',        hash: '#/solid',  mountId: 'single-spa-application:@stress/solid-component-lab' },
  { id: 'htmx-partials',       label: 'htmx · Partials',       stack: 'htmx + Rust + Pico.css',        hash: '#/htmx',   mountId: 'single-spa-application:@stress/htmx-partials' },
]

const sidebarMountId = 'single-spa-application:@stress/react-sidebar'

const currentHash = ref(window.location.hash || '#/')
function onHashChange() {
  currentHash.value = window.location.hash || '#/'
}

onMounted(() => window.addEventListener('hashchange', onHashChange))
onUnmounted(() => window.removeEventListener('hashchange', onHashChange))

const isHome = computed(() => currentHash.value === '#/' || currentHash.value === '')

function isActive(hash: string) {
  return currentHash.value === hash || currentHash.value.startsWith(hash + '/')
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar" :id="sidebarMountId" />

    <main class="content">
      <section v-show="isHome" class="overview">
        <div class="overview-inner">
          <h1>Annotask Stress Lab</h1>
          <p class="lede">
            Six MFEs, five backend services, one shell. Pick a route from the
            sidebar to mount its MFE into this pane — each route fills the
            entire content area.
          </p>

          <div class="cards">
            <a v-for="mfe in contentMfes" :key="mfe.hash" :href="mfe.hash" class="card">
              <div class="card-title">{{ mfe.label }}</div>
              <div class="card-stack">{{ mfe.stack }}</div>
              <code class="card-route">{{ mfe.hash }}</code>
            </a>
          </div>
        </div>
      </section>

      <div v-show="!isHome" class="viewport">
        <div
          v-for="mfe in contentMfes"
          v-show="isActive(mfe.hash)"
          :key="mfe.mountId"
          :id="mfe.mountId"
          class="mfe-mount"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: var(--stress-sidebar-width) 1fr;
  min-height: 100vh;
  background: var(--stress-bg);
  color: var(--stress-text);
  font-family: var(--stress-font);
}

.sidebar {
  background: var(--stress-sidebar-bg);
  border-right: 1px solid var(--stress-sidebar-border);
  min-height: 100vh;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: auto;
}

.content {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.overview {
  flex: 1;
  padding: 48px 48px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
.overview-inner { width: 100%; max-width: 1040px; }
.overview h1 { margin: 0 0 10px; font-size: 28px; letter-spacing: -0.02em; }
.lede { color: var(--stress-text-muted); margin: 0 0 28px; font-size: 14px; line-height: 1.6; max-width: 68ch; }

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 20px;
  border: 1px solid var(--stress-border);
  border-radius: var(--stress-radius);
  background: var(--stress-surface);
  color: inherit;
  text-decoration: none;
  transition: border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
}
.card:hover {
  border-color: var(--stress-accent);
  transform: translateY(-1px);
  box-shadow: var(--stress-shadow-sm);
}
.card-title { font-size: 15px; font-weight: 600; }
.card-stack { font-size: 12px; color: var(--stress-text-muted); }
.card-route {
  margin-top: auto;
  font-family: var(--stress-font-mono);
  font-size: 12px;
  color: var(--stress-accent);
}

.viewport {
  flex: 1;
  position: relative;
  min-height: 0;
  background: var(--stress-bg);
}
.mfe-mount {
  position: absolute;
  inset: 0;
  overflow: auto;
}

code { font-family: var(--stress-font-mono); }
</style>
