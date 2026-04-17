import { ref, watch, onUnmounted, type Ref } from 'vue'

interface UseAutoScanOptions {
  shellView: Ref<string>
  perfSection: Ref<string>
  perfRecording: Ref<boolean>
  runPerfScan: () => void
}

/** Debounced auto-scan on route/view changes. */
export function useAutoScan({ shellView, perfSection, perfRecording, runPerfScan }: UseAutoScanOptions) {
  let autoScanTimer: ReturnType<typeof setTimeout> | null = null

  const autoScanEnabled = ref(localStorage.getItem('annotask:auto-scan') !== 'false')
  watch(autoScanEnabled, (v) => localStorage.setItem('annotask:auto-scan', String(v)))

  function scheduleAutoScan() {
    if (!autoScanEnabled.value || shellView.value !== 'perf') return
    if (autoScanTimer) clearTimeout(autoScanTimer)
    // Debounce 500ms — let SPA route transitions settle
    autoScanTimer = setTimeout(() => {
      if (perfSection.value === 'vitals' && !perfRecording.value) {
        runPerfScan()
      }
      // A11y stays manual — too heavy for auto-scan
    }, 500)
  }

  onUnmounted(() => {
    if (autoScanTimer) {
      clearTimeout(autoScanTimer)
      autoScanTimer = null
    }
  })

  return { autoScanEnabled, scheduleAutoScan }
}
