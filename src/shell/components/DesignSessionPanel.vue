<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDesignSession } from '../composables/useDesignSession'
import ConfirmDialog from './ConfirmDialog.vue'

const emit = defineEmits<{
  /** Apply minted a task — the parent hands it to the embedded-agent auto-run
   *  when a provider is configured (otherwise it sits for an external agent). */
  'run-agent': [taskId: string]
}>()

const session = useDesignSession()

const pendingEntries = computed(() => session.entries.value.filter(
  (e) => !e.instanceId && (e.live.status === 'pending' || e.live.status === 'failed'),
))
const applyingEntries = computed(() => session.entries.value.filter((e) => e.live.status === 'applying'))
const writtenCount = computed(() => session.entries.value.filter((e) => e.live.status === 'written').length)
const files = computed(() => Object.entries(session.snapshotState.value.files)
  .map(([file, s]) => ({ file, ...s })))
const lastBatch = computed(() => {
  const batches = session.snapshotState.value.batches
  return batches.length ? batches[batches.length - 1] : null
})
/** Undo-coverage honesty for the newest batch (stamped at snapshot time).
 *  Absent on legacy batches — show nothing rather than guess. */
const coverageWarning = computed(() => {
  const c = lastBatch.value?.coverage
  if (c === 'anchors-only') return 'Undo coverage: anchors only'
  if (c === 'none') return 'Undo unavailable — not a git repo and no anchored files'
  return null
})
const banner = computed(() => session.lastError.value ?? session.syncError.value)

const confirmingDiscard = ref(false)

function statusChip(status: string): string {
  if (status === 'pending') return 'pending'
  if (status === 'applying') return 'applying…'
  if (status === 'written') return 'written'
  return 'failed'
}

async function onApply() {
  const result = await session.applyNow()
  if (result) emit('run-agent', result.taskId)
}

async function onDiscard() {
  confirmingDiscard.value = false
  await session.discardSession()
}
</script>

<template>
  <div v-if="session.entries.value.length || files.length" class="session-panel" data-testid="design-session-panel">
    <div class="session-head">
      <span class="session-title">Design session</span>
      <span v-if="writtenCount" class="session-summary written">{{ writtenCount }} in source</span>
      <span v-if="applyingEntries.length" class="session-summary applying">{{ applyingEntries.length }} applying</span>
    </div>

    <div v-if="banner" class="session-banner" role="alert">{{ banner }}</div>

    <div v-for="e in session.entries.value.filter((x) => !x.instanceId)" :key="e.id" class="session-row" :title="`${e.anchor.file}:${e.anchor.line}`">
      <span class="session-desc">{{ e.change.description }}</span>
      <span class="session-chip" :class="e.live.status">{{ statusChip(e.live.status) }}</span>
    </div>

    <div v-if="files.length" class="session-files">
      <div v-for="f in files" :key="f.file" class="session-file-row">
        <code class="session-file">{{ f.file }}</code>
        <template v-if="f.status === 'diverged'">
          <span class="session-chip failed" title="Edited outside Annotask — undo/discard will not touch it">diverged</span>
          <button class="session-detach" title="Keep the current file bytes and remove it from the session" @click="session.detachFile(f.file)">Detach</button>
        </template>
      </div>
    </div>

    <div class="session-actions">
      <button
        class="session-apply"
        :disabled="session.applyInFlight.value || pendingEntries.length === 0"
        :title="pendingEntries.length === 0
          ? 'No pending edits — make a change in the properties panel or drop a component'
          : 'Snapshot the touched files and hand the pending edits to the agent to write into source'"
        @click="onApply"
      >{{ session.applyInFlight.value ? 'Applying…' : `Apply ${pendingEntries.length || ''} edit${pendingEntries.length === 1 ? '' : 's'} (agent)` }}</button>
      <button
        v-if="lastBatch"
        class="session-undo"
        :disabled="session.applyInFlight.value"
        :title="session.applyInFlight.value
          ? 'Wait for the current apply to finish before undoing'
          : 'Restore the files this apply touched to their pre-apply bytes'"
        @click="session.undoLastBatch()"
      >Undo last apply</button>
      <button
        class="session-discard"
        :disabled="session.applyInFlight.value"
        :title="session.applyInFlight.value
          ? 'Wait for the current apply to finish before discarding'
          : 'Restore every touched file to its session-start bytes and remove session placements'"
        @click="confirmingDiscard = true"
      >Discard session</button>
    </div>

    <div v-if="coverageWarning" class="session-coverage" role="status" data-testid="session-coverage"
      title="Without a git baseline, undo can only restore the files the apply predicted — anything else the agent edits stays">
      {{ coverageWarning }}
    </div>

    <ConfirmDialog
      v-if="confirmingDiscard"
      :message="`Discard the design session? Every file the agent touched is restored to its session-start bytes${files.length ? ` (${files.length} file${files.length === 1 ? '' : 's'})` : ''} and session placements are removed.`"
      confirmLabel="Discard session"
      @confirm="onDiscard"
      @cancel="confirmingDiscard = false"
    />
  </div>
</template>

<style scoped>
.session-panel {
  border-top: 1px solid var(--border);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.session-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.session-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.session-summary {
  font-size: 10px;
  color: var(--text-muted);
}
.session-summary.written { color: var(--success); }
.session-summary.applying { color: var(--status-in-progress, var(--info)); }
.session-banner {
  font-size: 11px;
  padding: 6px 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  color: var(--danger);
}
.session-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.session-desc {
  font-size: 11px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.session-chip {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 999px;
  white-space: nowrap;
}
.session-chip.pending { background: color-mix(in srgb, var(--status-pending) 18%, transparent); color: var(--status-pending); }
.session-chip.applying { background: color-mix(in srgb, var(--status-in-progress) 18%, transparent); color: var(--status-in-progress); }
.session-chip.written { background: color-mix(in srgb, var(--status-accepted) 18%, transparent); color: var(--status-accepted); }
.session-chip.failed { background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); }
.session-files {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.session-file-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.session-file {
  font-size: 10px;
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.session-detach {
  font-size: 10px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-muted);
  padding: 1px 6px;
  cursor: pointer;
}
.session-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.session-actions button {
  font-size: 11px;
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
}
.session-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.session-coverage {
  font-size: 10px;
  color: var(--warning);
}
.session-apply {
  background: var(--accent) !important;
  border-color: var(--accent) !important;
  color: var(--text-on-accent) !important;
}
.session-discard {
  color: var(--danger) !important;
  border-color: color-mix(in srgb, var(--danger) 40%, transparent) !important;
}
</style>
