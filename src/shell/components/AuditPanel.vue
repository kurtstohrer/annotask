<template>
  <aside class="panel">
    <div class="tab-content">
      <PerfTab
        v-if="perfSection === 'vitals'"
        :recording="perfMonitor.recording.value"
        :recording-result="perfMonitor.recordingResult.value"
        :scan-result="perfMonitor.scanResult.value"
        :scan-loading="perfMonitor.scanLoading.value"
        :has-data="perfMonitor.hasData.value"
        :timeline="perfMonitor.timeline.value"
        :vitals="perfMonitor.vitals.value"
        :score="perfMonitor.perfScore.value"
        :findings="perfMonitor.perfFindings.value"
        :task-findings="perfMonitor.perfTaskFindings.value"
        :package-groups="perfMonitor.packageGroups.value"
        :error="perfMonitor.recordingError.value || perfMonitor.scanError.value"
        @start-recording="$emit('start-recording')"
        @stop-recording="$emit('stop-recording')"
        @scan="$emit('scan')"
        @create-task="$emit('create-perf-task', $event)"
      />
      <ErrorsTab
        v-else-if="perfSection === 'errors'"
        :errors="errorMonitor.errors.value"
        :error-count="errorMonitor.errorCount.value"
        :warn-count="errorMonitor.warnCount.value"
        :paused="errorMonitor.paused.value"
        :task-error-ids="errorMonitor.taskErrorIds.value"
        @create-task="$emit('create-error-task', $event)"
        @clear="$emit('clear-errors')"
        @toggle-pause="$emit('toggle-errors-pause')"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import PerfTab from './PerfTab.vue'
import ErrorsTab from './ErrorsTab.vue'
import type { usePerfMonitor, PerfFinding } from '../composables/usePerfMonitor'
import type { useErrorMonitor, ErrorEntry } from '../composables/useErrorMonitor'

interface Props {
  perfSection: 'vitals' | 'errors' | 'tasks'
  perfMonitor: ReturnType<typeof usePerfMonitor>
  errorMonitor: ReturnType<typeof useErrorMonitor>
}

defineProps<Props>()
defineEmits<{
  (e: 'start-recording'): void
  (e: 'stop-recording'): void
  (e: 'scan'): void
  (e: 'create-perf-task', finding: PerfFinding): void
  (e: 'create-error-task', error: ErrorEntry): void
  (e: 'clear-errors'): void
  (e: 'toggle-errors-pause'): void
}>()
</script>
