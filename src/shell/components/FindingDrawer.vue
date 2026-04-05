<script setup lang="ts">
defineProps<{
  title: string
  severity: string
  tasked: boolean
}>()

const emit = defineEmits<{
  close: []
  'create-task': []
}>()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <div class="fd-overlay" @keydown="onKeydown" tabindex="-1">
    <div class="fd-backdrop" @click="emit('close')" />
    <aside class="fd-drawer">
      <header class="fd-header">
        <div class="fd-header-left">
          <span class="fd-severity" :class="'sev-' + severity">{{ severity === 'needs-improvement' ? 'warn' : severity }}</span>
          <span class="fd-title">{{ title }}</span>
        </div>
        <button class="fd-close" @click="emit('close')" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </header>
      <div class="fd-body">
        <slot />
      </div>
      <footer class="fd-footer">
        <span v-if="tasked" class="fd-tasked">Task created</span>
        <button v-else class="fd-fix-btn" @click="emit('create-task')">Create Fix Task</button>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.fd-overlay { position: fixed; inset: 0; z-index: 50000; display: flex; justify-content: flex-end; }
.fd-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.4); }
.fd-drawer {
  position: relative; width: min(480px, 85vw); height: 100%;
  background: var(--surface); color: var(--text); border-left: 1px solid var(--border);
  display: flex; flex-direction: column;
  animation: fd-slide-in 0.15s ease-out;
}
@keyframes fd-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }

.fd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--border);
  background: var(--surface); flex-shrink: 0;
}
.fd-header-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fd-severity {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  padding: 2px 8px; border-radius: 4px; color: white; flex-shrink: 0;
}
.fd-severity.sev-poor, .fd-severity.sev-critical, .fd-severity.sev-serious { background: var(--danger); }
.fd-severity.sev-needs-improvement, .fd-severity.sev-moderate { background: var(--warning); }
.fd-severity.sev-good, .fd-severity.sev-minor { background: var(--severity-minor); }
.fd-title { font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-close { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 4px; border-radius: 4px; }
.fd-close:hover { background: var(--surface-2); color: var(--text); }

.fd-body { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; color: var(--text); }

.fd-footer {
  display: flex; gap: 8px; padding: 14px 18px;
  border-top: 1px solid var(--border); flex-shrink: 0; background: var(--surface);
}
.fd-fix-btn {
  padding: 6px 16px; font-size: 12px; font-weight: 600;
  background: var(--accent); color: var(--text-on-accent); border: none; border-radius: 6px; cursor: pointer;
}
.fd-fix-btn:hover { opacity: 0.9; }
.fd-tasked { font-size: 12px; font-weight: 600; color: var(--success); display: flex; align-items: center; gap: 4px; }
</style>
