<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useShellTheme } from '../composables/useShellTheme'
import { BUILTIN_THEMES, THEME_COLOR_KEYS } from '../themes'
import type { ShellThemeColors, ShellTheme } from '../themes'

const emit = defineEmits<{ close: [] }>()
const theme = useShellTheme()

const name = ref('My Theme')
const baseThemeId = ref('dark')
const themeType = ref<'dark' | 'light'>('dark')

// Initialize colors from the base theme
const colors = reactive<Record<string, string>>({})

function loadBase(id: string) {
  const base = BUILTIN_THEMES.find(t => t.id === id) || BUILTIN_THEMES[0]
  themeType.value = base.type
  for (const key of THEME_COLOR_KEYS) {
    colors[key] = base.colors[key]
  }
}

onMounted(() => loadBase(baseThemeId.value))

// Track what theme was active before editing so we can revert on cancel
const previousThemeId = ref(theme.activeThemeId.value)

// Apply live preview whenever colors change
function applyPreview() {
  const el = document.documentElement
  for (const key of THEME_COLOR_KEYS) {
    if (colors[key]) el.style.setProperty(`--${key}`, colors[key])
  }
  el.classList.toggle('light', themeType.value === 'light')
  el.classList.toggle('dark', themeType.value === 'dark')
}

function onColorChange(key: string, value: string) {
  colors[key] = value
  applyPreview()
}

function onBaseChange(id: string) {
  baseThemeId.value = id
  loadBase(id)
  applyPreview()
}

function save() {
  const id = `custom:${name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`
  const colorsCopy = {} as ShellThemeColors
  for (const key of THEME_COLOR_KEYS) {
    (colorsCopy as unknown as Record<string, string>)[key] = colors[key]
  }
  const newTheme: ShellTheme = {
    id,
    name: name.value,
    type: themeType.value,
    group: 'custom',
    isCustom: true,
    colors: colorsCopy,
  }
  theme.saveCustomTheme(newTheme)
  theme.setTheme(id)
  emit('close')
}

function cancel() {
  // Revert to previous theme
  theme.setTheme(previousThemeId.value)
  emit('close')
}

// Resolve rgba/color-mix values to a hex-like input value for the color picker
function toInputColor(val: string): string {
  if (val.startsWith('#') && (val.length === 4 || val.length === 7)) return val
  // For rgba/color-mix, return a neutral fallback — the text input shows the real value
  return '#808080'
}

const COLOR_GROUPS = [
  { label: 'Surfaces', keys: ['bg', 'surface', 'surface-2', 'surface-3', 'surface-elevated'] },
  { label: 'Borders', keys: ['border', 'border-strong'] },
  { label: 'Text', keys: ['text', 'text-muted', 'text-on-accent', 'text-inverse', 'text-link'] },
  { label: 'Accent', keys: ['accent', 'accent-hover'] },
  { label: 'Semantic', keys: ['danger', 'success', 'warning', 'info', 'focus-ring'] },
  { label: 'Palette', keys: ['purple', 'orange', 'cyan', 'indigo'] },
  { label: 'Status', keys: ['status-pending', 'status-in-progress', 'status-review', 'status-denied', 'status-accepted', 'status-needs-info', 'status-blocked'] },
  { label: 'Severity', keys: ['severity-critical', 'severity-serious', 'severity-moderate', 'severity-minor'] },
  { label: 'Modes', keys: ['mode-interact', 'mode-arrow', 'mode-draw', 'mode-highlight'] },
  { label: 'Layout', keys: ['layout-flex', 'layout-grid'] },
  { label: 'Roles', keys: ['role-container', 'role-content', 'role-component'] },
  { label: 'Syntax', keys: ['syntax-property', 'syntax-string', 'syntax-number', 'syntax-boolean', 'syntax-null', 'syntax-operator', 'syntax-punctuation'] },
  { label: 'Annotations', keys: ['annotation-red', 'annotation-orange', 'annotation-yellow', 'annotation-green', 'annotation-blue', 'annotation-purple'] },
]

const canSave = computed(() => name.value.trim().length > 0)
</script>

<template>
  <div class="te-overlay">
    <div class="te-header">
      <span class="te-title">Create Custom Theme</span>
      <div class="te-header-right">
        <button class="te-cancel" @click="cancel">Cancel</button>
        <button class="te-save" :disabled="!canSave" @click="save">Save Theme</button>
      </div>
    </div>
    <div class="te-body">
      <div class="te-meta">
        <div class="te-field">
          <label class="te-label">Theme Name</label>
          <input class="te-input" v-model="name" placeholder="My Theme" />
        </div>
        <div class="te-field">
          <label class="te-label">Base Theme</label>
          <select class="te-select" :value="baseThemeId" @change="onBaseChange(($event.target as HTMLSelectElement).value)">
            <option v-for="t in BUILTIN_THEMES" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </div>
        <div class="te-field">
          <label class="te-label">Type</label>
          <div class="te-type-toggle">
            <button :class="['te-type-btn', { active: themeType === 'dark' }]" @click="themeType = 'dark'; applyPreview()">Dark</button>
            <button :class="['te-type-btn', { active: themeType === 'light' }]" @click="themeType = 'light'; applyPreview()">Light</button>
          </div>
        </div>
      </div>

      <div v-for="group in COLOR_GROUPS" :key="group.label" class="te-group">
        <div class="te-group-label">{{ group.label }}</div>
        <div class="te-color-grid">
          <div v-for="key in group.keys" :key="key" class="te-color-row">
            <input
              type="color"
              class="te-color-picker"
              :value="toInputColor(colors[key] || '')"
              @input="onColorChange(key, ($event.target as HTMLInputElement).value)"
            />
            <span class="te-color-name">{{ key }}</span>
            <input
              class="te-color-hex"
              :value="colors[key] || ''"
              @change="onColorChange(key, ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.te-overlay {
  position: absolute; inset: 0; z-index: 51;
  background: var(--surface); display: flex; flex-direction: column;
}
.te-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.te-title { font-size: 13px; font-weight: 600; color: var(--text); }
.te-header-right { display: flex; gap: 6px; }
.te-cancel {
  padding: 5px 14px; font-size: 11px; background: var(--surface-2);
  color: var(--text-muted); border: 1px solid var(--border); border-radius: 5px; cursor: pointer;
}
.te-cancel:hover { color: var(--text); }
.te-save {
  padding: 5px 14px; font-size: 11px; font-weight: 600;
  background: var(--accent); color: var(--text-on-accent); border: none; border-radius: 5px; cursor: pointer;
}
.te-save:disabled { opacity: 0.4; cursor: not-allowed; }
.te-save:hover:not(:disabled) { opacity: 0.9; }

.te-body { flex: 1; overflow-y: auto; padding: 16px 20px; }

.te-meta { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.te-field { display: flex; flex-direction: column; gap: 4px; }
.te-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
.te-input, .te-select {
  padding: 5px 8px; font-size: 12px; background: var(--bg); border: 1px solid var(--border);
  border-radius: 5px; color: var(--text); outline: none; min-width: 140px;
}
.te-input:focus, .te-select:focus { border-color: var(--accent); }
.te-select { cursor: pointer; }

.te-type-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 5px; overflow: hidden; }
.te-type-btn {
  padding: 5px 12px; font-size: 11px; border: none; background: var(--surface-2);
  color: var(--text-muted); cursor: pointer;
}
.te-type-btn + .te-type-btn { border-left: 1px solid var(--border); }
.te-type-btn.active { background: var(--accent); color: var(--text-on-accent); }

.te-group { margin-bottom: 16px; }
.te-group-label {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-muted); margin-bottom: 6px; padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.te-color-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px; }
.te-color-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
.te-color-picker {
  width: 24px; height: 24px; border: 1px solid var(--border); border-radius: 4px;
  padding: 0; cursor: pointer; background: none; flex-shrink: 0;
}
.te-color-picker::-webkit-color-swatch-wrapper { padding: 1px; }
.te-color-picker::-webkit-color-swatch { border: none; border-radius: 2px; }
.te-color-name { font-size: 11px; color: var(--text); min-width: 100px; font-family: monospace; }
.te-color-hex {
  flex: 1; padding: 2px 6px; font-size: 10px; font-family: monospace;
  background: var(--bg); border: 1px solid var(--border); border-radius: 3px;
  color: var(--text); outline: none; min-width: 80px;
}
.te-color-hex:focus { border-color: var(--accent); }
</style>
