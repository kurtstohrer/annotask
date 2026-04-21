<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NAlert,
  NBadge,
  NButton,
  NCard,
  NConfigProvider,
  NDescriptions,
  NDescriptionsItem,
  NLayout,
  NLayoutContent,
  NSpace,
  NTag,
  NText,
  darkTheme,
  type GlobalTheme,
} from 'naive-ui'
import type { Health, HealthStatus } from '@annotask/stress-contracts'
import { getTheme, onThemeChange, type StressTheme } from '@annotask/stress-ui-tokens'

type Snapshot = {
  status: HealthStatus | 'unreachable' | 'loading'
  service: string | null
  version: string | null
  port: number | null
  latencyMs: number | null
  error: string | null
}

const empty: Snapshot = {
  status: 'loading',
  service: null,
  version: null,
  port: null,
  latencyMs: null,
  error: null,
}

// One ref per service so annotask's scanner resolves each as a
// distinct data source and binds it to its own card in the template.
const fastapiHealth = ref<Snapshot>({ ...empty })
const javaHealth = ref<Snapshot>({ ...empty })
const goHealth = ref<Snapshot>({ ...empty })
const nodeHealth = ref<Snapshot>({ ...empty })
const rustHealth = ref<Snapshot>({ ...empty })

const refreshing = ref(false)
const lastChecked = ref<string | null>(null)

const stressTheme = ref<StressTheme>(getTheme())
const naiveTheme = computed<GlobalTheme | null>(() =>
  stressTheme.value === 'dark' ? darkTheme : null,
)
let unsubscribeTheme: (() => void) | null = null

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const started = performance.now()
  const value = await fn()
  return { value, latencyMs: Math.round(performance.now() - started) }
}

async function pingFastapi() {
  fastapiHealth.value = { ...empty }
  try {
    const { value: body, latencyMs } = await timed(async () => {
      const res = await fetch('http://localhost:4320/api/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as Health
    })
    fastapiHealth.value = {
      status: body.status,
      service: body.service,
      version: body.version,
      port: body.port,
      latencyMs,
      error: null,
    }
  } catch (err) {
    fastapiHealth.value = {
      ...empty,
      status: 'unreachable',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function pingJavaApi() {
  javaHealth.value = { ...empty }
  try {
    const { value: body, latencyMs } = await timed(async () => {
      const res = await fetch('http://localhost:4310/api/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as Health
    })
    javaHealth.value = {
      status: body.status,
      service: body.service,
      version: body.version,
      port: body.port,
      latencyMs,
      error: null,
    }
  } catch (err) {
    javaHealth.value = {
      ...empty,
      status: 'unreachable',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function pingGoApi() {
  goHealth.value = { ...empty }
  try {
    const { value: body, latencyMs } = await timed(async () => {
      const res = await fetch('http://localhost:4330/api/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as Health
    })
    goHealth.value = {
      status: body.status,
      service: body.service,
      version: body.version,
      port: body.port,
      latencyMs,
      error: null,
    }
  } catch (err) {
    goHealth.value = {
      ...empty,
      status: 'unreachable',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function pingNodeApi() {
  nodeHealth.value = { ...empty }
  try {
    const { value: body, latencyMs } = await timed(async () => {
      const res = await fetch('http://localhost:4340/api/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as Health
    })
    nodeHealth.value = {
      status: body.status,
      service: body.service,
      version: body.version,
      port: body.port,
      latencyMs,
      error: null,
    }
  } catch (err) {
    nodeHealth.value = {
      ...empty,
      status: 'unreachable',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function pingRustApi() {
  rustHealth.value = { ...empty }
  try {
    const { value: body, latencyMs } = await timed(async () => {
      const res = await fetch('http://localhost:4360/api/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as Health
    })
    rustHealth.value = {
      status: body.status,
      service: body.service,
      version: body.version,
      port: body.port,
      latencyMs,
      error: null,
    }
  } catch (err) {
    rustHealth.value = {
      ...empty,
      status: 'unreachable',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function refreshAll() {
  refreshing.value = true
  await Promise.all([
    pingFastapi(),
    pingJavaApi(),
    pingGoApi(),
    pingNodeApi(),
    pingRustApi(),
  ])
  lastChecked.value = new Date().toLocaleTimeString()
  refreshing.value = false
}

onMounted(() => {
  unsubscribeTheme = onThemeChange((t) => (stressTheme.value = t))
  refreshAll()
})
onUnmounted(() => {
  unsubscribeTheme?.()
})

const statusTone: Record<Snapshot['status'], 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  ok: 'success',
  degraded: 'warning',
  down: 'error',
  unreachable: 'error',
  loading: 'info',
}

const snapshots = computed(() => [
  fastapiHealth.value,
  javaHealth.value,
  goHealth.value,
  nodeHealth.value,
  rustHealth.value,
])

const summary = computed(() => {
  const counts = { ok: 0, degraded: 0, down: 0, unreachable: 0, loading: 0 }
  for (const s of snapshots.value) counts[s.status]++
  return counts
})
</script>

<template>
  <NConfigProvider :theme="naiveTheme">
    <NLayout style="background: var(--stress-bg); min-height: 100%">
      <NLayoutContent content-style="padding: 32px 40px;">
        <header class="header">
          <h1>Services Health</h1>
          <p class="sub">
            Pings <code>/api/health</code> on every backend in the stress lab · one data source per card · Naive UI
          </p>
        </header>

        <NSpace vertical :size="16" style="width: 100%">
          <NCard size="small">
            <template #header>
              <NSpace :size="8" align="center">
                <span>Summary</span>
                <NTag v-if="summary.ok" type="success" size="small" round>{{ summary.ok }} ok</NTag>
                <NTag v-if="summary.degraded" type="warning" size="small" round>{{ summary.degraded }} degraded</NTag>
                <NTag v-if="summary.down" type="error" size="small" round>{{ summary.down }} down</NTag>
                <NTag v-if="summary.unreachable" type="error" size="small" round>{{ summary.unreachable }} unreachable</NTag>
                <NTag v-if="summary.loading" type="info" size="small" round>{{ summary.loading }} loading</NTag>
              </NSpace>
            </template>
            <template #header-extra>
              <NSpace :size="8" align="center">
                <NText v-if="lastChecked" depth="3" style="font-size: 12px;">last checked {{ lastChecked }}</NText>
                <NButton size="small" :loading="refreshing" @click="refreshAll">Refresh all</NButton>
              </NSpace>
            </template>
            <NAlert v-if="summary.unreachable + summary.down" type="warning" :show-icon="false">
              Some services aren't responding. Start the full stack with
              <code>just up</code> or start individual services with
              <code>just fastapi</code> / <code>just go</code> / <code>just node</code> /
              <code>just rust</code>. The Java service runs under <code>just compose-up</code>.
            </NAlert>
            <NText v-else-if="summary.ok === 5" depth="3">
              All 5 services are healthy.
            </NText>
          </NCard>

          <div class="grid">
            <NCard size="small" class="service-card" data-service="fastapi">
              <template #header>
                <NSpace :size="8" align="center">
                  <NTag type="info" size="small" round>Python · :4320</NTag>
                  <strong>FastAPI</strong>
                </NSpace>
              </template>
              <template #header-extra>
                <NButton size="tiny" :loading="fastapiHealth.status === 'loading'" @click="pingFastapi">Ping</NButton>
              </template>
              <NDescriptions :column="1" label-placement="left" size="small" bordered>
                <NDescriptionsItem label="status">
                  <NTag :type="statusTone[fastapiHealth.status]" size="small" round>{{ fastapiHealth.status }}</NTag>
                </NDescriptionsItem>
                <NDescriptionsItem label="service">
                  <code v-if="fastapiHealth.service">{{ fastapiHealth.service }}</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem label="version">
                  <code v-if="fastapiHealth.version">{{ fastapiHealth.version }}</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem label="latency">
                  <code v-if="fastapiHealth.latencyMs !== null">{{ fastapiHealth.latencyMs }} ms</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem v-if="fastapiHealth.error" label="error">
                  <code class="err">{{ fastapiHealth.error }}</code>
                </NDescriptionsItem>
              </NDescriptions>
            </NCard>

            <NCard size="small" class="service-card" data-service="java-api">
              <template #header>
                <NSpace :size="8" align="center">
                  <NTag type="info" size="small" round>Java · :4310</NTag>
                  <strong>Spring Boot</strong>
                </NSpace>
              </template>
              <template #header-extra>
                <NButton size="tiny" :loading="javaHealth.status === 'loading'" @click="pingJavaApi">Ping</NButton>
              </template>
              <NDescriptions :column="1" label-placement="left" size="small" bordered>
                <NDescriptionsItem label="status">
                  <NTag :type="statusTone[javaHealth.status]" size="small" round>{{ javaHealth.status }}</NTag>
                </NDescriptionsItem>
                <NDescriptionsItem label="service">
                  <code v-if="javaHealth.service">{{ javaHealth.service }}</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem label="version">
                  <code v-if="javaHealth.version">{{ javaHealth.version }}</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem label="latency">
                  <code v-if="javaHealth.latencyMs !== null">{{ javaHealth.latencyMs }} ms</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem v-if="javaHealth.error" label="error">
                  <code class="err">{{ javaHealth.error }}</code>
                </NDescriptionsItem>
              </NDescriptions>
            </NCard>

            <NCard size="small" class="service-card" data-service="go-api">
              <template #header>
                <NSpace :size="8" align="center">
                  <NTag type="info" size="small" round>Go · :4330</NTag>
                  <strong>Go API</strong>
                </NSpace>
              </template>
              <template #header-extra>
                <NButton size="tiny" :loading="goHealth.status === 'loading'" @click="pingGoApi">Ping</NButton>
              </template>
              <NDescriptions :column="1" label-placement="left" size="small" bordered>
                <NDescriptionsItem label="status">
                  <NTag :type="statusTone[goHealth.status]" size="small" round>{{ goHealth.status }}</NTag>
                </NDescriptionsItem>
                <NDescriptionsItem label="service">
                  <code v-if="goHealth.service">{{ goHealth.service }}</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem label="version">
                  <code v-if="goHealth.version">{{ goHealth.version }}</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem label="latency">
                  <code v-if="goHealth.latencyMs !== null">{{ goHealth.latencyMs }} ms</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem v-if="goHealth.error" label="error">
                  <code class="err">{{ goHealth.error }}</code>
                </NDescriptionsItem>
              </NDescriptions>
            </NCard>

            <NCard size="small" class="service-card" data-service="node-api">
              <template #header>
                <NSpace :size="8" align="center">
                  <NTag type="info" size="small" round>Node · :4340</NTag>
                  <strong>Fastify</strong>
                </NSpace>
              </template>
              <template #header-extra>
                <NButton size="tiny" :loading="nodeHealth.status === 'loading'" @click="pingNodeApi">Ping</NButton>
              </template>
              <NDescriptions :column="1" label-placement="left" size="small" bordered>
                <NDescriptionsItem label="status">
                  <NTag :type="statusTone[nodeHealth.status]" size="small" round>{{ nodeHealth.status }}</NTag>
                </NDescriptionsItem>
                <NDescriptionsItem label="service">
                  <code v-if="nodeHealth.service">{{ nodeHealth.service }}</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem label="version">
                  <code v-if="nodeHealth.version">{{ nodeHealth.version }}</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem label="latency">
                  <code v-if="nodeHealth.latencyMs !== null">{{ nodeHealth.latencyMs }} ms</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem v-if="nodeHealth.error" label="error">
                  <code class="err">{{ nodeHealth.error }}</code>
                </NDescriptionsItem>
              </NDescriptions>
            </NCard>

            <NCard size="small" class="service-card" data-service="rust-api">
              <template #header>
                <NSpace :size="8" align="center">
                  <NTag type="info" size="small" round>Rust · :4360</NTag>
                  <strong>Rust API</strong>
                </NSpace>
              </template>
              <template #header-extra>
                <NButton size="tiny" :loading="rustHealth.status === 'loading'" @click="pingRustApi">Ping</NButton>
              </template>
              <NDescriptions :column="1" label-placement="left" size="small" bordered>
                <NDescriptionsItem label="status">
                  <NTag :type="statusTone[rustHealth.status]" size="small" round>{{ rustHealth.status }}</NTag>
                </NDescriptionsItem>
                <NDescriptionsItem label="service">
                  <code v-if="rustHealth.service">{{ rustHealth.service }}</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem label="version">
                  <code v-if="rustHealth.version">{{ rustHealth.version }}</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem label="latency">
                  <code v-if="rustHealth.latencyMs !== null">{{ rustHealth.latencyMs }} ms</code>
                  <NText v-else depth="3">—</NText>
                </NDescriptionsItem>
                <NDescriptionsItem v-if="rustHealth.error" label="error">
                  <code class="err">{{ rustHealth.error }}</code>
                </NDescriptionsItem>
              </NDescriptions>
            </NCard>
          </div>
        </NSpace>
      </NLayoutContent>
    </NLayout>
  </NConfigProvider>
</template>

<style scoped>
.header h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: -0.01em; }
.sub { color: var(--stress-text-muted); margin: 0 0 20px; font-size: 13px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
}
.service-card { min-width: 0; }
code {
  font-family: var(--stress-font-mono);
  font-size: 12px;
  background: var(--stress-surface-2);
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--stress-text);
}
code.err { color: var(--stress-danger, #e5484d); background: transparent; padding: 0; }
</style>
