<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  interactionHistory: unknown
}>()

interface LogEntry {
  event: string
  route?: string
  detail: string
  data: Record<string, unknown>
}

const historyLog = computed<LogEntry[]>(() => {
  const ih = props.interactionHistory as any
  if (!ih?.recent_actions) return []
  return ih.recent_actions.map((a: any) => {
    let detail = ''
    if (a.event === 'route_change') {
      const prev = a.data?.previousRoute
      detail = prev ? `${prev} → ${a.route || ih.current_route}` : `navigated to ${a.route || ih.current_route}`
    } else if (a.event === 'action') {
      const parts: string[] = []
      if (a.data?.tag) parts.push(`<${a.data.tag}>`)
      if (a.data?.text) parts.push(`"${String(a.data.text).slice(0, 40)}"`)
      if (a.data?.href) parts.push(`→ ${a.data.href}`)
      detail = parts.join(' ') || 'user action'
    } else {
      detail = JSON.stringify(a.data || {})
    }
    return { event: a.event, route: a.route, detail, data: a.data || {} }
  })
})

const historyRoute = computed(() => (props.interactionHistory as any)?.current_route || '')
const historyNavPath = computed<string[]>(() => (props.interactionHistory as any)?.navigation_path || [])
</script>

<template>
  <section v-if="historyLog.length" class="td-section">
    <h4 class="td-label">
      Interaction History
      <span v-if="historyRoute" class="td-history-current">on {{ historyRoute }}</span>
    </h4>
    <div v-if="historyNavPath.length > 1" class="td-nav-path">
      <span v-for="(p, i) in historyNavPath" :key="i" class="td-nav-step">
        <span class="td-nav-route">{{ p }}</span>
        <span v-if="i < historyNavPath.length - 1" class="td-nav-sep">→</span>
      </span>
    </div>
    <div class="td-log">
      <div v-for="(entry, i) in historyLog" :key="i" class="td-log-entry">
        <span class="td-log-idx">{{ i + 1 }}</span>
        <span :class="['td-log-event', entry.event]">{{ entry.event === 'route_change' ? 'navigate' : entry.event }}</span>
        <span class="td-log-detail">{{ entry.detail }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.td-section { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.td-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0; display: flex; align-items: baseline; gap: 6px; }
.td-history-current { font-size: 10px; font-weight: 500; color: var(--text-muted); text-transform: none; letter-spacing: 0; }
.td-nav-path { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font-size: 11px; color: var(--text-muted); padding: 4px 8px; background: var(--surface-2); border-radius: 4px; }
.td-nav-step { display: flex; align-items: center; gap: 4px; }
.td-nav-route { color: var(--text); font-family: ui-monospace, 'SF Mono', monospace; }
.td-nav-sep { color: var(--text-muted); }
.td-log { display: flex; flex-direction: column; font-family: ui-monospace, 'SF Mono', monospace; font-size: 10px; }
.td-log-entry { display: flex; align-items: baseline; gap: 6px; padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
.td-log-idx { color: var(--text-muted); min-width: 18px; text-align: right; font-variant-numeric: tabular-nums; }
.td-log-event { font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 0 4px; border-radius: 2px; flex-shrink: 0; }
.td-log-event.route_change { color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }
.td-log-event.action { color: var(--success); background: color-mix(in srgb, var(--success) 15%, transparent); }
.td-log-detail { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
