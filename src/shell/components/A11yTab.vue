<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  violations: Array<{ id: string; impact: string; description: string; help: string; helpUrl: string; nodes: number }>
  loading: boolean
  error: string | null
  scanned: boolean
  scanTarget: string
}>()

const emit = defineEmits<{ 'scan': [target: 'element' | 'page'] }>()
</script>

<template>
  <div class="a11y-tab">
    <div class="a11y-header">
      <span class="section-label">Accessibility</span>
      <div class="scan-actions">
        <button class="scan-btn" :disabled="loading" @click="emit('scan', 'element')">
          {{ loading ? 'Scanning...' : 'Scan Element' }}
        </button>
        <button class="scan-btn scan-page" :disabled="loading" @click="emit('scan', 'page')">Page</button>
      </div>
    </div>

    <div v-if="error" class="a11y-error">{{ error }}</div>

    <div v-if="!loading && violations.length === 0 && !error && scanned" class="a11y-pass">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
      No violations — {{ scanTarget }}
    </div>
    <div v-else-if="!loading && violations.length === 0 && !error" class="a11y-empty">
      <p>Click Scan to check accessibility</p>
    </div>

    <div v-if="violations.length" class="a11y-summary">
      {{ violations.length }} violation{{ violations.length === 1 ? '' : 's' }} — {{ scanTarget }}
    </div>

    <div v-for="v in violations" :key="v.id" class="a11y-violation" :class="v.impact">
      <div class="v-header">
        <span class="v-impact" :class="v.impact">{{ v.impact }}</span>
        <span class="v-id">{{ v.id }}</span>
        <span class="v-nodes">{{ v.nodes }} element{{ v.nodes === 1 ? '' : 's' }}</span>
      </div>
      <p class="v-help">{{ v.help }}</p>
    </div>
  </div>
</template>

<style scoped>
.a11y-tab { display: flex; flex-direction: column; gap: 8px; }
.a11y-header { display: flex; align-items: center; justify-content: space-between; }
.section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }

.scan-btn {
  padding: 3px 10px; font-size: 10px; font-weight: 600;
  background: var(--accent); color: white; border: none; border-radius: 4px; cursor: pointer;
}
.scan-btn:disabled { opacity: 0.5; cursor: default; }
.scan-btn:hover:not(:disabled) { opacity: 0.9; }
.scan-btn.scan-page { background: var(--surface-2); color: var(--text-muted); border: 1px solid var(--border); }
.scan-btn.scan-page:hover:not(:disabled) { background: var(--border); color: var(--text); }
.scan-actions { display: flex; gap: 4px; }

.a11y-error { font-size: 11px; color: #ef4444; padding: 6px 8px; background: rgba(239,68,68,0.1); border-radius: 5px; }
.a11y-pass {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;
  background: rgba(34, 197, 94, 0.12); color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.25);
}
.a11y-summary {
  font-size: 11px; font-weight: 600; color: #ef4444;
  padding: 6px 8px; border-radius: 5px;
  background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2);
}
.a11y-empty { font-size: 11px; color: var(--text-muted); padding: 12px 0; text-align: center; }
.a11y-empty p { margin: 0; }

.a11y-violation {
  padding: 8px; border-radius: 6px;
  background: var(--surface-2); border-left: 3px solid var(--border);
}
.a11y-violation.critical { border-left-color: #dc2626; }
.a11y-violation.serious { border-left-color: #ef4444; }
.a11y-violation.moderate { border-left-color: #f59e0b; }
.a11y-violation.minor { border-left-color: #6b7280; }

.v-header { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.v-impact {
  font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 1px 5px;
  border-radius: 3px; color: white;
}
.v-impact.critical { background: #dc2626; }
.v-impact.serious { background: #ef4444; }
.v-impact.moderate { background: #f59e0b; }
.v-impact.minor { background: #6b7280; }

.v-id { font-weight: 600; color: var(--text); }
.v-nodes { margin-left: auto; color: var(--text-muted); font-size: 10px; }
.v-help { margin: 4px 0 0; font-size: 11px; color: var(--text-muted); line-height: 1.4; }
</style>
