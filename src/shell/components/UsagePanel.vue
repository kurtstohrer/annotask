<script setup lang="ts">
/**
 * Usage & Metrics panel — scoped to one provider.
 *
 * Polls `/__annotask/api/usage` every 15s and shows the cumulative totals
 * for the selected provider only (the `byProvider[providerId]` slice). The
 * provider picker lives in the parent (SettingsOverlay's LLM Providers tab
 * header); switching it flips the data shown here.
 *
 * When the backend has no rows for the selected provider yet, an empty
 * state explains why instead of rendering a wall of zeros.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { ProviderId } from '../../embedded/provider-config'

const props = defineProps<{ providerId: ProviderId }>()

interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  turns: number
  /** Entries whose counts were character-length estimates (CLI reported no
   *  or output-only usage). Optional: pre-upgrade ledgers won't send it. */
  estimatedTurns?: number
}
interface UsageSummary {
  totals: UsageTotals
  byScope: Record<'task' | 'init' | 'apply' | 'chat', UsageTotals>
  byProvider: Record<string, UsageTotals>
  firstAt: number | null
  lastAt: number | null
}

const usageSummary = ref<UsageSummary | null>(null)
let usagePollTimer: number | null = null

async function refreshUsage() {
  try {
    const res = await fetch('/__annotask/api/usage')
    if (!res.ok) return
    usageSummary.value = await res.json()
  } catch { /* offline — keep previous */ }
}

onMounted(() => {
  void refreshUsage()
  usagePollTimer = window.setInterval(refreshUsage, 15_000)
})
onBeforeUnmount(() => {
  if (usagePollTimer !== null) { window.clearInterval(usagePollTimer); usagePollTimer = null }
})

function formatTokens(n: number): string {
  if (n < 1000) return n.toString()
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`
}

function formatRelative(ts: number | null): string {
  if (!ts) return '—'
  const ms = Date.now() - ts
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}

/** This provider's totals, or null when no rows have been logged for it. */
const providerTotals = computed<UsageTotals | null>(() => {
  const row = usageSummary.value?.byProvider?.[props.providerId]
  if (!row || row.turns === 0) return null
  return row
})

/** Provider's share of overall project usage — informational. */
const providerShare = computed<number | null>(() => {
  const grand = usageSummary.value?.totals
  if (!grand || grand.turns === 0) return null
  const mine = providerTotals.value
  if (!mine) return 0
  const grandTokens = grand.inputTokens + grand.outputTokens
  if (grandTokens === 0) return null
  const mineTokens = mine.inputTokens + mine.outputTokens
  return Math.round((mineTokens / grandTokens) * 1000) / 10
})
</script>

<template>
  <div class="usage-panel">
    <p class="usage-lead">
      Cumulative tokens <strong>{{ providerId }}</strong> has consumed in this
      project — across initialization, task conversations, and apply runs.
      Read from <code>.annotask/usage.jsonl</code>.
    </p>

    <div v-if="!providerTotals" class="usage-empty">
      No usage recorded for <code>{{ providerId }}</code> yet. Start a
      conversation on a task or run init with this provider selected.
    </div>

    <template v-else>
      <div class="usage-grid" data-testid="usage-summary">
        <div class="usage-card">
          <div class="usage-card-label">Input</div>
          <div class="usage-card-value">{{ formatTokens(providerTotals.inputTokens) }}</div>
        </div>
        <div class="usage-card">
          <div class="usage-card-label">Output</div>
          <div class="usage-card-value">{{ formatTokens(providerTotals.outputTokens) }}</div>
        </div>
        <div class="usage-card">
          <div class="usage-card-label">Cache read</div>
          <div class="usage-card-value">{{ formatTokens(providerTotals.cacheReadTokens) }}</div>
        </div>
        <div class="usage-card">
          <div class="usage-card-label">Cache write</div>
          <div class="usage-card-value">{{ formatTokens(providerTotals.cacheCreationTokens) }}</div>
        </div>
        <div class="usage-card">
          <div class="usage-card-label">Turns</div>
          <div class="usage-card-value">{{ providerTotals.turns.toLocaleString() }}</div>
        </div>
        <div class="usage-card">
          <div class="usage-card-label">Last activity</div>
          <div class="usage-card-value usage-card-value-small">{{ formatRelative(usageSummary?.lastAt ?? null) }}</div>
        </div>
      </div>

      <p v-if="providerShare !== null" class="usage-share">
        That's <strong>{{ providerShare }}%</strong> of total project usage
        across all providers.
      </p>

      <p
        v-if="(providerTotals.estimatedTurns ?? 0) > 0"
        class="usage-share"
        data-testid="usage-estimated-note"
      >
        ≈ {{ providerTotals.estimatedTurns }} of {{ providerTotals.turns }} turns
        are character-length <strong>estimates</strong> — this CLI didn't report
        full token counts.
      </p>
    </template>
  </div>
</template>

<style scoped>
.usage-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.usage-lead {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.55;
}
.usage-lead code {
  font-size: 11px;
  padding: 1px 5px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text);
}

.usage-empty {
  padding: 24px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 8px;
}

.usage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.usage-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.usage-card-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.usage-card-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.usage-card-value-small { font-size: 13px; font-weight: 500; }

.usage-share {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}
.usage-share strong {
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
</style>
