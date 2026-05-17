<template>
  <div
    ref="hostRef"
    class="md-editor"
    :class="{ 'md-editor-bordered': bordered }"
    :aria-label="ariaLabel"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { EditorView, keymap, placeholder, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import {
  HighlightStyle,
  syntaxHighlighting,
  bracketMatching,
} from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'

/**
 * Markdown editor backed by CodeMirror 6.
 *
 * Why CM6 vs a textarea overlay:
 *   - Caret never drifts (CM owns its own selection model).
 *   - Real soft-wrap with proper line numbers and active-line styling.
 *   - Bracket matching, undo/redo, search keymap — table stakes for editing
 *     longer agent prompts.
 *   - Theming via `EditorView.theme` keeps the editor visually in sync with
 *     the shell's CSS vars across all 18 built-in themes (we map each token
 *     to a `var(--…)` so theme switches just work without re-mounting CM).
 *
 * API is intentionally narrow (`v-model` + placeholder) so this drops into
 * any spot a `<textarea>` previously lived.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    ariaLabel?: string
    bordered?: boolean
    /** Show the gutter with line numbers. Default off — most prompt
     *  editors don't want it, but the style-guide editor turns it on. */
    showLineNumbers?: boolean
  }>(),
  { placeholder: '', ariaLabel: 'Markdown editor', bordered: false, showLineNumbers: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const hostRef = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null

// Compartments let us hot-swap a single facet without rebuilding the editor —
// theme tokens use CSS vars so we don't need to swap on theme change, but
// placeholder text + line numbers can change between mounts of the same
// editor (e.g. swapping personas in AgentDirectionsPanel).
const placeholderCompartment = new Compartment()
const gutterCompartment = new Compartment()

/** Map Lezer tags to themed CSS vars so a theme switch (dark↔light, Monokai
 *  etc.) re-colors the editor without remounting CodeMirror. */
const markdownHighlight = HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6, t.heading], color: 'var(--accent)', fontWeight: '600' },
  { tag: t.strong, color: 'var(--text)', fontWeight: '700' },
  { tag: t.emphasis, color: 'var(--text)', fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-muted)' },
  { tag: t.link, color: 'var(--text-link)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--text-link)' },
  { tag: t.monospace, color: 'var(--syntax-string)', backgroundColor: 'color-mix(in srgb, var(--surface-2) 80%, transparent)' },
  { tag: [t.quote], color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--accent)' },
  { tag: t.contentSeparator, color: 'var(--text-muted)' },
  { tag: t.processingInstruction, color: 'var(--text-muted)' },
  // Code fences + inline code content.
  { tag: t.string, color: 'var(--syntax-string)' },
  { tag: t.number, color: 'var(--syntax-number)' },
  { tag: t.bool, color: 'var(--syntax-boolean)' },
  { tag: t.comment, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: t.keyword, color: 'var(--syntax-property)' },
  { tag: t.atom, color: 'var(--syntax-boolean)' },
  { tag: t.meta, color: 'var(--text-muted)' },
])

/** Theme that maps every CM6 surface to the shell's CSS vars. */
const themeExt = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12.5px',
    color: 'var(--text)',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.6',
  },
  '.cm-content': {
    padding: '14px 18px',
    caretColor: 'var(--text)',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 4%, transparent)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    border: 'none',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--text)',
  },
  '.cm-placeholder': {
    color: 'var(--text-muted)',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)',
    outline: 'none',
  },
}, { dark: false })

function makeExtensions() {
  return [
    history(),
    drawSelection(),
    highlightActiveLine(),
    bracketMatching(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(markdownHighlight),
    themeExt,
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    placeholderCompartment.of(placeholder(props.placeholder)),
    gutterCompartment.of(props.showLineNumbers ? lineNumbers() : []),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        const next = u.state.doc.toString()
        if (next !== props.modelValue) emit('update:modelValue', next)
      }
    }),
  ]
}

onMounted(() => {
  if (!hostRef.value) return
  view = new EditorView({
    state: EditorState.create({ doc: props.modelValue, extensions: makeExtensions() }),
    parent: hostRef.value,
  })
})

onBeforeUnmount(() => { view?.destroy(); view = null })

// External writes to v-model (e.g. user switched persona): replace the doc
// without echoing back through the change listener.
watch(() => props.modelValue, (next) => {
  if (!view) return
  if (next === view.state.doc.toString()) return
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: next },
  })
})

watch(() => props.placeholder, (next) => {
  view?.dispatch({ effects: placeholderCompartment.reconfigure(placeholder(next)) })
})

watch(() => props.showLineNumbers, (next) => {
  view?.dispatch({ effects: gutterCompartment.reconfigure(next ? lineNumbers() : []) })
})
</script>

<style scoped>
.md-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--surface);
  overflow: hidden;
}
.md-editor-bordered {
  border: 1px solid var(--border);
  border-radius: 6px;
}
.md-editor :deep(.cm-editor) {
  flex: 1;
  height: 100%;
  width: 100%;
}
.md-editor:focus-within {
  background: color-mix(in srgb, var(--accent) 2%, var(--surface));
}
</style>
