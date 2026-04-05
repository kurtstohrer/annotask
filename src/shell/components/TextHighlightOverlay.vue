<script setup lang="ts">
import type { TextHighlight } from '../composables/useAnnotations'

defineProps<{
  highlights: TextHighlight[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
  remove: [id: string]
  'update-prompt': [id: string, prompt: string]
}>()
</script>

<template>
  <!-- Visual highlights on the page -->
  <div
    v-for="h in highlights"
    :key="'vis-' + h.id"
  >
    <div
      v-if="h.rect"
      class="text-highlight-visual"
      :class="{ selected: h.id === selectedId }"
      :style="{
        left: h.rect.x + 'px', top: h.rect.y + 'px',
        width: h.rect.width + 'px', height: h.rect.height + 'px',
        background: h.color + '30',
        borderBottom: '2px solid ' + h.color,
        boxShadow: h.id === selectedId ? '0 0 0 1px ' + h.color : 'none',
      }"
      @click.stop="emit('select', h.id)"
    >
      <span class="highlight-badge" :style="{ background: h.color }">#{{ h.number }}</span>
    </div>
  </div>

  <!-- Highlight cards (in overlay area) -->
  <div
    v-for="h in highlights"
    :key="h.id"
    class="text-highlight-card"
    :class="{ selected: h.id === selectedId }"
    :style="{ borderColor: h.id === selectedId ? h.color : undefined }"
    @click.stop="emit('select', h.id)"
  >
    <div class="hl-header">
      <span class="hl-badge" :style="{ color: h.color }">#{{ h.number }}</span>
      <code class="hl-file">{{ h.file }}:{{ h.line }}</code>
      <button class="hl-delete" @click.stop="emit('remove', h.id)">×</button>
    </div>
    <div class="hl-text" :style="{ color: h.color }">"{{ h.selectedText }}"</div>
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
/* Visual highlight on the page */
.text-highlight-visual {
  position: fixed;
  z-index: 10003;
  border-radius: 2px;
  cursor: pointer;
  pointer-events: auto;
  transition: box-shadow 0.15s;
}
.highlight-badge {
  position: absolute; top: -10px; left: -2px;
  font-size: 8px; font-weight: 700; color: white;
  padding: 0 4px; border-radius: 3px;
  line-height: 14px; pointer-events: none;
}

/* Highlight cards */
.text-highlight-card {
  position: relative;
  margin: 4px 0;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--mode-highlight) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--mode-highlight) 20%, transparent);
  border-radius: 6px;
  cursor: pointer;
}
.text-highlight-card.selected { border-color: var(--mode-highlight); }
.hl-header { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.hl-badge { font-size: 9px; font-weight: 700; color: var(--mode-highlight); }
.hl-file { font-size: 9px; color: var(--text-muted, #71717a); }
.hl-delete {
  margin-left: auto; width: 14px; height: 14px; border: none; background: none;
  color: var(--text-muted); font-size: 12px; cursor: pointer; padding: 0; display: none;
}
.text-highlight-card:hover .hl-delete { display: block; }
.hl-text { font-size: 11px; color: var(--mode-highlight); font-style: italic; margin-bottom: 2px; }
.hl-prompt { font-size: 11px; color: var(--text, #e4e4e7); }
.hl-prompt-edit {
  width: 100%; margin-top: 4px; padding: 4px 6px;
  background: var(--bg, #0a0a0a); border: 1px solid var(--border, #2a2a2a);
  border-radius: 4px; color: var(--text); font-size: 11px; outline: none;
}
.hl-prompt-edit:focus { border-color: var(--mode-highlight); }
</style>
