<script setup lang="ts">
import type { TextHighlight } from '../composables/useAnnotations'

defineProps<{
  highlights: TextHighlight[]
  selectedId: string | null
  /** Pending highlight: text selected, waiting for prompt */
  pending: { text: string; x: number; y: number } | null
}>()

const emit = defineEmits<{
  select: [id: string]
  remove: [id: string]
  'update-prompt': [id: string, prompt: string]
  'submit-pending': [prompt: string]
  'cancel-pending': []
}>()
</script>

<template>
  <!-- Pending highlight prompt (just selected text, need user's prompt) -->
  <div v-if="pending" class="highlight-prompt" :style="{ left: pending.x + 'px', top: pending.y + 'px' }">
    <div class="prompt-header">
      <span class="prompt-text-preview">"{{ pending.text.substring(0, 50) }}{{ pending.text.length > 50 ? '...' : '' }}"</span>
    </div>
    <input
      class="prompt-input"
      placeholder="What should this text become?"
      autofocus
      @keydown.enter="emit('submit-pending', ($event.target as HTMLInputElement).value)"
      @keydown.escape="emit('cancel-pending')"
    />
    <div class="prompt-hint">Enter to submit, Escape to cancel</div>
  </div>

  <!-- Existing highlights -->
  <div
    v-for="h in highlights"
    :key="h.id"
    class="text-highlight-card"
    :class="{ selected: h.id === selectedId }"
    @click.stop="emit('select', h.id)"
  >
    <div class="hl-header">
      <span class="hl-badge">#{{ h.number }}</span>
      <code class="hl-file">{{ h.file }}:{{ h.line }}</code>
      <button class="hl-delete" @click.stop="emit('remove', h.id)">×</button>
    </div>
    <div class="hl-text">"{{ h.selectedText }}"</div>
    <div v-if="h.prompt" class="hl-prompt">→ {{ h.prompt }}</div>
    <input
      v-if="h.id === selectedId"
      class="hl-prompt-edit"
      :value="h.prompt"
      placeholder="What should this become?"
      @input="emit('update-prompt', h.id, ($event.target as HTMLInputElement).value)"
      @click.stop
    />
  </div>
</template>

<style scoped>
/* Pending prompt popup */
.highlight-prompt {
  position: fixed;
  z-index: 10005;
  background: var(--surface, #141414);
  border: 1px solid #f59e0b;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  padding: 8px;
  width: 280px;
}
.prompt-header { margin-bottom: 6px; }
.prompt-text-preview {
  font-size: 11px; color: #f59e0b; font-style: italic;
  display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.prompt-input {
  width: 100%; padding: 6px 8px;
  background: var(--bg, #0a0a0a); border: 1px solid var(--border, #2a2a2a);
  border-radius: 5px; color: var(--text, #e4e4e7); font-size: 12px; outline: none;
}
.prompt-input:focus { border-color: #f59e0b; }
.prompt-hint { font-size: 9px; color: var(--text-muted, #71717a); margin-top: 4px; }

/* Highlight cards (shown in panel or floating) */
.text-highlight-card {
  position: relative;
  margin: 4px 0;
  padding: 6px 8px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: 6px;
  cursor: pointer;
}
.text-highlight-card.selected { border-color: #f59e0b; }
.hl-header { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.hl-badge { font-size: 9px; font-weight: 700; color: #f59e0b; }
.hl-file { font-size: 9px; color: var(--text-muted, #71717a); }
.hl-delete {
  margin-left: auto; width: 14px; height: 14px; border: none; background: none;
  color: var(--text-muted); font-size: 12px; cursor: pointer; padding: 0; display: none;
}
.text-highlight-card:hover .hl-delete { display: block; }
.hl-text { font-size: 11px; color: #f59e0b; font-style: italic; margin-bottom: 2px; }
.hl-prompt { font-size: 11px; color: var(--text, #e4e4e7); }
.hl-prompt-edit {
  width: 100%; margin-top: 4px; padding: 4px 6px;
  background: var(--bg, #0a0a0a); border: 1px solid var(--border, #2a2a2a);
  border-radius: 4px; color: var(--text); font-size: 11px; outline: none;
}
.hl-prompt-edit:focus { border-color: #f59e0b; }
</style>
