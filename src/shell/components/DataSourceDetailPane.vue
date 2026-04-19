<script setup lang="ts">
import { computed } from 'vue'
import type { DataSourceDetailsResult } from '../../schema'
import { tokenize } from '../utils/highlightJs'

const props = defineProps<{
  details: DataSourceDetailsResult | null
  isLoading: boolean
  error: string | null
}>()

const isFound = computed(() => !!props.details && !('error' in props.details))
const isAmbiguous = computed(() => !!props.details && 'error' in props.details && props.details.error === 'ambiguous')
const isNotFound = computed(() => !!props.details && 'error' in props.details && props.details.error === 'not_found')

const found = computed(() => (isFound.value ? (props.details as Extract<DataSourceDetailsResult, { resolved_by: 'regex' }>) : null))
const ambiguous = computed(() => (isAmbiguous.value ? (props.details as Extract<DataSourceDetailsResult, { error: 'ambiguous' }>) : null))

const signatureTokens = computed(() => (found.value?.signature ? tokenize(found.value.signature) : []))
const importsTokens = computed(() => (found.value?.imports?.length ? tokenize(found.value.imports.join('\n')) : []))
const excerptTokens = computed(() => (found.value?.body_excerpt ? tokenize(found.value.body_excerpt) : []))

function confidenceColor(c: 'high' | 'medium' | 'low'): string {
  if (c === 'high') return 'var(--success)'
  if (c === 'medium') return 'var(--warning)'
  return 'var(--danger)'
}
</script>

<template>
  <div class="ds-pane">
    <div v-if="isLoading" class="ds-status">Loading definition…</div>
    <div v-else-if="error" class="ds-status error">{{ error }}</div>

    <div v-else-if="isNotFound" class="ds-status">
      No definition found. The scanner may have missed it, or the symbol has moved.
    </div>

    <div v-else-if="ambiguous" class="ds-status">
      <p><strong>Multiple definitions share this name:</strong></p>
      <ul class="ds-candidates">
        <li v-for="(c, i) in ambiguous.candidates" :key="i">
          <code>{{ c.kind }}</code> <strong>{{ c.name }}</strong>
          <span class="ds-file">{{ c.file }}:{{ c.line }}</span>
        </li>
      </ul>
      <p class="ds-hint">Narrow by picking a specific file from the left list.</p>
    </div>

    <div v-else-if="found" class="ds-body">
      <div class="ds-row">
        <span class="ds-label">File</span>
        <code>{{ found.file }}:{{ found.line }}</code>
      </div>

      <div class="ds-row">
        <span class="ds-label">Confidence</span>
        <span class="ds-confidence" :style="{ color: confidenceColor(found.confidence) }">
          {{ found.confidence }}
        </span>
        <span class="ds-hint">(resolved by {{ found.resolved_by }})</span>
      </div>

      <div v-if="found.signature" class="ds-section">
        <span class="ds-label">Signature</span>
        <pre class="ds-code"><span v-for="(t, i) in signatureTokens" :key="i" :class="'tok-' + t.cls">{{ t.text }}</span></pre>
      </div>

      <div v-if="found.return_type" class="ds-row">
        <span class="ds-label">Return type</span>
        <code>{{ found.return_type }}</code>
      </div>

      <div v-if="found.referenced_types && found.referenced_types.length" class="ds-row">
        <span class="ds-label">Referenced types</span>
        <span class="ds-chips">
          <code v-for="(t, i) in found.referenced_types" :key="i">{{ t }}</code>
        </span>
      </div>

      <div v-if="found.imports.length" class="ds-section">
        <span class="ds-label">Imports</span>
        <pre class="ds-code imports"><span v-for="(t, i) in importsTokens" :key="i" :class="'tok-' + t.cls">{{ t.text }}</span></pre>
      </div>

      <div class="ds-section">
        <span class="ds-label">
          Body excerpt
          <span class="ds-hint">(lines {{ found.excerpt_start_line }}–{{ found.excerpt_end_line }})</span>
        </span>
        <pre class="ds-code excerpt"><span v-for="(t, i) in excerptTokens" :key="i" :class="'tok-' + t.cls">{{ t.text }}</span></pre>
      </div>

      <div v-if="found.siblings.length" class="ds-section">
        <span class="ds-label">Siblings in this file</span>
        <ul class="ds-siblings">
          <li v-for="(s, i) in found.siblings" :key="i">
            <code class="ds-sibling-kind">{{ s.kind }}</code>
            <strong>{{ s.name }}</strong>
            <span class="ds-hint">line {{ s.line }}</span>
          </li>
        </ul>
      </div>
    </div>

    <div v-else class="ds-status">
      Select an entry to see its definition.
    </div>
  </div>
</template>

<style scoped>
.ds-pane {
  padding: 12px;
  font-size: 12px;
  color: var(--text);
}
.ds-status {
  color: var(--text-muted);
  padding: 12px 0;
  font-size: 12px;
}
.ds-status.error {
  color: var(--danger);
}
.ds-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ds-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}
.ds-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ds-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  font-weight: 600;
}
.ds-hint {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: normal;
  text-transform: none;
  letter-spacing: normal;
  margin-left: 4px;
}
.ds-confidence {
  font-weight: 600;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.05em;
}
.ds-code {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  max-width: 100%;
  max-height: 320px;
  overflow-y: auto;
  overflow-x: hidden;
  margin: 0;
  color: var(--text);
}
.ds-code .tok-keyword { color: var(--purple, #c678dd); }
.ds-code .tok-type    { color: var(--cyan, #56b6c2); }
.ds-code .tok-string  { color: var(--syntax-string, var(--success)); }
.ds-code .tok-number  { color: var(--syntax-number, var(--orange)); }
.ds-code .tok-boolean { color: var(--syntax-boolean, var(--orange)); }
.ds-code .tok-null    { color: var(--syntax-null, var(--text-muted)); }
.ds-code .tok-comment { color: var(--text-muted); font-style: italic; }
.ds-code .tok-punct   { color: var(--syntax-punctuation, var(--text-muted)); }
.ds-code .tok-ident   { color: var(--text); }
.ds-code.imports {
  color: var(--text-muted);
  max-height: 160px;
}
.ds-code.excerpt {
  max-height: 420px;
}
.ds-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ds-chips code {
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}
.ds-siblings {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ds-siblings li {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}
.ds-sibling-kind {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 3px;
}
.ds-candidates {
  list-style: none;
  padding: 0;
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ds-candidates li {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}
.ds-file {
  color: var(--text-muted);
  margin-left: 6px;
}
</style>
