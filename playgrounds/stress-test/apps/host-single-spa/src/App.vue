<script setup lang="ts">
import { computed, ref } from 'vue'

type MfeStatus = 'implemented' | 'stub'

interface Mfe {
  id: string
  label: string
  stack: string
  url: string
  status: MfeStatus
}

const mfes: Mfe[] = [
  { id: 'vue-data-lab', label: 'Vue · Data Lab', stack: 'Vue + FastAPI', url: 'http://localhost:4220/', status: 'implemented' },
  { id: 'react-workflows', label: 'React · Workflows', stack: 'React + Java', url: 'http://localhost:4210/', status: 'stub' },
  { id: 'svelte-streaming', label: 'Svelte · Streaming', stack: 'Svelte + Go', url: 'http://localhost:4230/', status: 'stub' },
  { id: 'solid-component-lab', label: 'Solid · Component Lab', stack: 'Solid + Node', url: 'http://localhost:4240/', status: 'stub' },
  { id: 'blade-legacy-lab', label: 'Blade · Legacy Lab', stack: 'Blade + Laravel', url: 'http://localhost:4350/', status: 'implemented' },
  { id: 'htmx-partials', label: 'htmx · Partials', stack: 'htmx + Rust', url: 'http://localhost:4260/', status: 'stub' },
]

const active = ref<Mfe | null>(null)
const activeId = computed(() => active.value?.id ?? null)

function select(mfe: Mfe) {
  active.value = mfe
}

function home() {
  active.value = null
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <button class="brand" type="button" @click="home">Annotask Stress Lab</button>
      <nav class="nav">
        <button
          v-for="mfe in mfes"
          :key="mfe.id"
          type="button"
          class="nav-btn"
          :class="{ active: mfe.id === activeId, stub: mfe.status === 'stub' }"
          @click="select(mfe)"
        >
          {{ mfe.label }}
          <span v-if="mfe.status === 'stub'" class="pill">stub</span>
        </button>
      </nav>
    </header>

    <main class="main">
      <section v-if="!active" class="overview">
        <h1>Host (single-spa root)</h1>
        <p>
          This is the stress-lab host on port 4200. Each button above switches
          the viewport below to a child MFE running on its own port. MFEs
          marked <span class="pill">stub</span> don't have code yet — only
          their directory and README exist.
        </p>
        <p>
          The current skeleton uses iframes for MFE composition. Real
          single-spa parcel/module-federation wiring lands once at least two
          MFEs are implemented.
        </p>

        <table class="grid">
          <thead>
            <tr><th>MFE</th><th>Stack</th><th>URL</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr v-for="mfe in mfes" :key="mfe.id">
              <td>{{ mfe.label }}</td>
              <td>{{ mfe.stack }}</td>
              <td><code>{{ mfe.url }}</code></td>
              <td>
                <span class="pill" :class="mfe.status">{{ mfe.status }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-else class="viewport">
        <div class="viewport-bar">
          <strong>{{ active.label }}</strong>
          <span class="meta">mfe: <code>{{ active.id }}</code></span>
          <span class="meta">url: <code>{{ active.url }}</code></span>
          <span v-if="active.status === 'stub'" class="pill stub">stub — not implemented</span>
        </div>
        <iframe
          v-if="active.status === 'implemented'"
          :src="active.url"
          class="frame"
          :title="active.label"
        />
        <div v-else class="frame placeholder">
          <p>
            <strong>{{ active.label }}</strong> has not been implemented yet.
            See the plan and the MFE's README for the intended scope.
          </p>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #e8ecf1;
  background: #0b0f17;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid #1e2836;
  background: #0f1623;
  position: sticky;
  top: 0;
  z-index: 1;
}

.brand {
  font-weight: 600;
  font-size: 15px;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  padding: 0;
}

.nav {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid #24314a;
  border-radius: 999px;
  background: transparent;
  color: #bac5d4;
  font-size: 13px;
  cursor: pointer;
}

.nav-btn:hover {
  border-color: #3c5170;
  color: #e8ecf1;
}

.nav-btn.active {
  background: #1d64e3;
  border-color: #1d64e3;
  color: #fff;
}

.nav-btn.stub {
  opacity: 0.75;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.overview {
  padding: 32px 28px;
  max-width: 880px;
  line-height: 1.55;
}

.overview h1 {
  margin-top: 0;
  font-size: 22px;
}

.grid {
  width: 100%;
  border-collapse: collapse;
  margin-top: 20px;
  font-size: 13px;
}

.grid th,
.grid td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid #1e2836;
}

.grid th {
  color: #8793a6;
  font-weight: 500;
}

.pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  background: #1e2836;
  color: #8793a6;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.pill.stub {
  background: #3b2c1a;
  color: #f0b880;
}

.pill.implemented {
  background: #1a3b2a;
  color: #7fd9a2;
}

.viewport {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.viewport-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 16px;
  border-bottom: 1px solid #1e2836;
  background: #0f1623;
  font-size: 12px;
}

.meta {
  color: #8793a6;
}

.frame {
  flex: 1;
  width: 100%;
  border: 0;
  background: #fff;
}

.frame.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: #8793a6;
  background: #0b0f17;
}

code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  color: #c6d1e1;
}
</style>
