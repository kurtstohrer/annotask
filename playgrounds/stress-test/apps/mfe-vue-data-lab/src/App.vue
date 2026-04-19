<script setup lang="ts">
import { onMounted, ref } from 'vue'

interface HealthResponse {
  status: string
  service: string
  port: number
  version: string
}

const health = ref<HealthResponse | null>(null)
const error = ref<string | null>(null)
const loading = ref(true)

async function loadHealth() {
  loading.value = true
  error.value = null
  try {
    const res = await fetch('/api/health')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    health.value = (await res.json()) as HealthResponse
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

onMounted(loadHealth)
</script>

<template>
  <main class="page">
    <header>
      <h1>Vue Data Lab</h1>
      <p class="sub">
        MFE id <code>vue-data-lab</code> · port 4220 · backed by FastAPI on :4320
      </p>
    </header>

    <section class="panel">
      <h2>What this stresses</h2>
      <ul>
        <li>Vue composables + typed API client as a data-access pattern</li>
        <li>FastAPI OpenAPI schema discovery</li>
        <li>Cross-MFE isolation — tasks created here get <code>mfe: vue-data-lab</code></li>
      </ul>
    </section>

    <section class="panel">
      <h2>Upstream health</h2>
      <p v-if="loading">Loading <code>/api/health</code>…</p>
      <p v-else-if="error" class="err">
        Failed to reach FastAPI: <code>{{ error }}</code>. Start it with
        <code>pnpm dev:stress-fastapi</code> from the repo root.
      </p>
      <dl v-else-if="health" class="kv">
        <dt>status</dt><dd>{{ health.status }}</dd>
        <dt>service</dt><dd>{{ health.service }}</dd>
        <dt>port</dt><dd>{{ health.port }}</dd>
        <dt>version</dt><dd>{{ health.version }}</dd>
      </dl>

      <button type="button" class="retry" @click="loadHealth">Refresh</button>
    </section>
  </main>
</template>

<style scoped>
.page {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #1a202c;
  padding: 28px 32px;
  max-width: 780px;
  line-height: 1.55;
}

header h1 {
  margin: 0 0 4px;
  font-size: 22px;
}

.sub {
  color: #64748b;
  margin: 0 0 24px;
  font-size: 13px;
}

.panel {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 18px 20px;
  margin-bottom: 16px;
  background: #fff;
}

.panel h2 {
  margin: 0 0 10px;
  font-size: 15px;
  color: #334155;
}

.panel ul {
  margin: 0;
  padding-left: 18px;
}

.kv {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 6px 16px;
  margin: 8px 0 12px;
  font-size: 13px;
}

.kv dt {
  color: #64748b;
}

.kv dd {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.err {
  color: #b91c1c;
}

.retry {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  cursor: pointer;
  font-size: 13px;
}

code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  background: #f1f5f9;
  padding: 1px 5px;
  border-radius: 4px;
}
</style>
