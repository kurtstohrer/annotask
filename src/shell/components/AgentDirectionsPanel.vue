<template>
  <div class="adp">
    <!-- Left: persona list -->
    <ul class="adp-list" role="listbox" aria-label="Agents">
      <li
        v-for="p in allPersonas"
        :key="p.id"
        role="option"
        :aria-selected="selectedId === p.id"
        class="adp-item"
        :class="{ selected: selectedId === p.id, custom: p.isCustom }"
        @click="select(p.id)"
      >
        <span class="adp-item-name">{{ p.name }}</span>
        <span v-if="p.isCustom" class="adp-item-badge">custom</span>
        <p class="adp-item-desc">{{ p.description }}</p>
        <div class="adp-item-runtime">
          <span class="adp-item-runtime-provider">{{ providerLabel(p.id) }}</span>
          <span v-if="modelFor(p.id)" class="adp-item-runtime-model">{{ modelFor(p.id) }}</span>
          <span class="adp-item-runtime-effort">{{ effortFor(p.id) }}</span>
        </div>
        <div class="adp-item-types">
          <span v-for="t in p.taskTypes" :key="t" class="adp-chip">{{ t }}</span>
        </div>
      </li>
    </ul>

    <!-- Right: content -->
    <div v-if="selected" class="adp-content">
      <div class="adp-content-header">
        <div class="adp-content-meta">
          <h3 class="adp-content-title">{{ selected.name }}</h3>
          <p class="adp-content-desc">{{ selected.description }}</p>
        </div>
        <div class="adp-toggle" role="group" aria-label="View mode">
          <button :class="['adp-mode', { active: mode === 'preview' }]" @click="mode = 'preview'">
            Preview
          </button>
          <button :class="['adp-mode', { active: mode === 'edit' }]" @click="mode = 'edit'">
            Edit
          </button>
        </div>
      </div>

      <!-- Per-agent runtime config: provider, model, effort. Auto-saves on change. -->

      <!-- Blocked-state warning. Hoisted above the row so users see WHY
           the picker is degraded (or replaced with a text input) before
           they try to interact with it. Same diagnosis as the wizard's
           AgentQuickSetup banner, kept in sync deliberately. -->
      <div
        v-if="modelsBlocked"
        class="adp-runtime-warning"
        role="alert"
        data-testid="adp-engine-model-blocked"
      >
        <strong>Cannot fetch models.</strong>
        {{ modelCatalog.error || 'The live probe returned nothing.' }}
        Defaulting to Auto — enter a custom id in the Model field if you'd rather override.
      </div>

      <div class="adp-runtime">
        <label class="adp-field">
          <span class="adp-field-label">Provider</span>
          <select
            class="adp-select"
            :value="effectiveProvider"
            :disabled="runtimeSaving"
            @change="onProviderChange(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="p in CLI_PROVIDER_OPTIONS" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </label>
        <label class="adp-field">
          <span class="adp-field-label">Model</span>
          <!-- When the catalog has a real list (or a static catalog), pick
               from it. When it doesn't — Copilot CLI is the canonical case;
               its `/model` picker is interactive only — fall back to a
               plain text input. Empty = Auto (CLI default). -->
          <select
            v-if="!modelsBlocked"
            class="adp-select"
            :value="effectiveModel"
            :disabled="runtimeSaving || modelsLoading"
            data-testid="adp-engine-model"
            @change="onModelChange(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
            <!-- Persist a previously-saved model id that isn't in the
                 discovered list so we don't silently lose the user's choice. -->
            <option v-if="effectiveModel && !modelOptions.some(m => m.id === effectiveModel)" :value="effectiveModel">
              {{ effectiveModel }} (custom)
            </option>
          </select>
          <!-- Manual model entry for providers whose catalog can't be
               enumerated live (Copilot CLI is the canonical case — its model
               picker is interactive only). Shows the SAVED id so a custom model
               (e.g. a Copilot-hosted Claude model) is visible and persists on
               reload; empty = Auto. A stale id from a DIFFERENT provider is
               cleared on provider change (see onProviderChange), NOT here — so
               we never wipe a value the user deliberately entered. -->
          <input
            v-else
            type="text"
            class="adp-input"
            :value="effectiveModel"
            :disabled="runtimeSaving"
            placeholder="Auto (CLI default)"
            data-testid="adp-engine-model-manual"
            @change="onModelChange(($event.target as HTMLInputElement).value.trim())"
          />
        </label>
        <label class="adp-field">
          <span class="adp-field-label">Effort</span>
          <select
            class="adp-select"
            :value="effectiveEffort"
            :disabled="runtimeSaving"
            @change="onEffortChange(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="e in effortOptionsForProvider" :key="e" :value="e">{{ e }}</option>
          </select>
        </label>
      </div>

      <!-- Preview -->
      <div
        v-if="mode === 'preview'"
        class="adp-preview markdown-body"
        v-html="renderedContent || emptyHint"
      />

      <!-- Edit -->
      <template v-else>
        <MarkdownEditor
          v-model="draftContent"
          :placeholder="`Project-specific context for the ${selected.name} agent.\n\nWritten in markdown. Appended to the base prompt before applying any ${selected.taskTypes.join(', ')} task.`"
          :aria-label="`Project directions for ${selected.name}`"
          class="adp-editor"
        />
        <div class="adp-save-row">
          <span v-if="saveStatus === 'saved'" class="adp-save-ok">✓ Saved</span>
          <button class="adp-save-btn" :disabled="saving" @click="save">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </template>
    </div>

    <div v-else class="adp-empty">
      <p>Select an agent on the left to view and edit its directions.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import MarkdownEditor from './MarkdownEditor.vue'
import { safeMd } from '../utils/safeMd'
import { useAgentConfigs } from '../composables/useAgentConfigs'
import { useProviderSettings } from '../composables/useProviderSettings'
import { useAgentModels } from '../composables/useAgentModels'
import { BUILT_IN_PERSONAS } from '../../embedded/persona'
import type { PersonaConfig } from '../../embedded/persona'
import {
  EFFORT_LEVELS,
  EFFORTS_BY_PROVIDER,
  type ProviderId,
  type EffortLevel,
} from '../../embedded/provider-config'

// Per the product decision: agent settings panel only exposes the four
// CLI-style providers for now. Direct-API providers will be folded in when
// the apply path supports them.
const CLI_PROVIDER_OPTIONS: Array<{ id: ProviderId; label: string }> = [
  { id: 'claude-local',   label: 'Claude (local CLI)' },
  { id: 'codex-local',    label: 'Codex (local CLI)' },
  { id: 'opencode-local', label: 'OpenCode (local CLI)' },
  { id: 'copilot-local',  label: 'Copilot (local CLI)' },
]
const emptyHint = '<p class="adp-empty-hint">No directions written yet. Switch to Edit to add some.</p>'

const agentConfigs = useAgentConfigs()
const settings = useProviderSettings()

// Merge built-ins (with server directions) + custom personas
const allPersonas = computed<PersonaConfig[]>(() => settings.personas.value)

const selectedId = ref<string | null>(BUILT_IN_PERSONAS[0]?.id ?? null)
const mode = ref<'preview' | 'edit'>('preview')
const draftContent = ref('')
const saving = ref(false)
const saveStatus = ref<'idle' | 'saved'>('idle')
let saveStatusTimer: ReturnType<typeof setTimeout> | null = null

const selected = computed(() => allPersonas.value.find(p => p.id === selectedId.value) ?? null)

// The canonical content for the selected persona
const currentContent = computed(() => {
  if (!selected.value) return ''
  if (!selected.value.isCustom) {
    return agentConfigs.configs.value[selected.value.id]?.projectDirections ?? ''
  }
  return selected.value.systemPromptExtras ?? ''
})

// Sync draft whenever selection or server data changes (but don't clobber in-flight edits)
watch([selected, currentContent], ([, content]) => {
  draftContent.value = content
  mode.value = 'preview'
  saveStatus.value = 'idle'
}, { immediate: true })

const renderedContent = computed(() => {
  const md = draftContent.value.trim()
  if (!md) return ''
  try { return safeMd(md) } catch { return safeMd(md) }
})

function providerLabel(personaId: string): string {
  const persona = allPersonas.value.find(p => p.id === personaId)
  if (!persona) return ''
  const providerId = persona.isCustom
    ? persona.providerId
    : (agentConfigs.configs.value[personaId]?.providerId ?? persona.providerId)
  return CLI_PROVIDER_OPTIONS.find(p => p.id === providerId)?.label ?? providerId
}
function modelFor(personaId: string): string {
  const persona = allPersonas.value.find(p => p.id === personaId)
  if (!persona) return ''
  if (persona.isCustom) return persona.model
  const override = agentConfigs.configs.value[personaId]?.model
  return typeof override === 'string' ? override : persona.model
}
function effortFor(personaId: string): EffortLevel {
  const persona = allPersonas.value.find(p => p.id === personaId)
  if (!persona) return 'auto'
  if (persona.isCustom) return persona.effort
  return agentConfigs.configs.value[personaId]?.effort ?? persona.effort
}

function select(id: string) {
  if (selectedId.value === id) return
  selectedId.value = id
}

async function save() {
  if (!selected.value) return
  saving.value = true
  if (!selected.value.isCustom) {
    await agentConfigs.save(selected.value.id, { projectDirections: draftContent.value })
  } else {
    settings.upsertPersona({ ...selected.value, systemPromptExtras: draftContent.value })
  }
  saving.value = false
  saveStatus.value = 'saved'
  mode.value = 'preview'
  if (saveStatusTimer) clearTimeout(saveStatusTimer)
  saveStatusTimer = setTimeout(() => { saveStatus.value = 'idle' }, 3000)
}

// ── Per-agent runtime config (provider / model / effort) ────────────────────
// For built-in personas: persisted to .annotask/agents.json via the API.
// For custom personas: persisted to localStorage via upsertPersona.

const runtimeSaving = ref(false)

const effectiveProvider = computed<ProviderId>(() => {
  if (!selected.value) return 'claude-local'
  if (selected.value.isCustom) return selected.value.providerId
  const override = agentConfigs.configs.value[selected.value.id]?.providerId
  return override ?? selected.value.providerId
})

const effectiveModel = computed<string>(() => {
  if (!selected.value) return ''
  if (selected.value.isCustom) return selected.value.model
  const override = agentConfigs.configs.value[selected.value.id]?.model
  return typeof override === 'string' ? override : selected.value.model
})

const effectiveEffort = computed<EffortLevel>(() => {
  if (!selected.value) return 'auto'
  if (selected.value.isCustom) return selected.value.effort
  const override = agentConfigs.configs.value[selected.value.id]?.effort
  return override ?? selected.value.effort
})

// Provider-driven dropdown options. Effort filters to the provider's
// supported set so users can't pick one the provider drops.
const effortOptionsForProvider = computed<readonly EffortLevel[]>(() =>
  EFFORTS_BY_PROVIDER[effectiveProvider.value] ?? EFFORT_LEVELS,
)

// Models: sourced from the singleton useAgentModels cache so the picker
// stays in sync with Settings → Providers and the InitWizard. The composable
// dedupes fetches and persists to localStorage. There is no curated fallback —
// when the live probe returns nothing the dropdown is blocked and a warning
// directs the user back to Settings → Providers to enter a model id manually.
const agentModels = useAgentModels()
const modelCatalog = computed(() => agentModels.catalogFor(effectiveProvider.value).value)
const modelOptions = computed(() => modelCatalog.value.models)
const modelsLoading = computed(() => agentModels.state.loading[effectiveProvider.value] === true)
const modelsBlocked = computed(
  () => !modelsLoading.value && modelOptions.value.length <= 1 && !modelCatalog.value.discovered,
)

// Kick off a fetch whenever the effective provider changes (initial mount
// included via immediate).
watch(effectiveProvider, (id) => { void agentModels.ensure(id) }, { immediate: true })

// NB: we deliberately do NOT auto-reset the saved model when the catalog can't
// be fetched (modelsBlocked). A model id the live probe can't enumerate (e.g. a
// Copilot-hosted model) is still a valid, user-entered value — wiping it here
// was a data-loss bug that made per-agent model pins silently fail to persist.
// A genuinely stale id left over from a DIFFERENT provider is cleared on
// provider change instead (see onProviderChange).

async function persistRuntime(patch: { providerId?: ProviderId; model?: string; effort?: EffortLevel }) {
  if (!selected.value) return
  runtimeSaving.value = true
  if (selected.value.isCustom) {
    settings.upsertPersona({ ...selected.value, ...patch })
  } else {
    await agentConfigs.save(selected.value.id, patch)
  }
  runtimeSaving.value = false
  saveStatus.value = 'saved'
  if (saveStatusTimer) clearTimeout(saveStatusTimer)
  saveStatusTimer = setTimeout(() => { saveStatus.value = 'idle' }, 2000)
}

function onProviderChange(value: string) {
  if (!CLI_PROVIDER_OPTIONS.some(p => p.id === value)) return
  const nextProvider = value as ProviderId
  // A model id is provider-specific, so clear it when the provider changes —
  // this is the ONE place a stale cross-provider model is dropped (it replaces
  // the old modelsBlocked auto-wipe). The user then picks/enters the new
  // provider's model, which now persists.
  const patch: { providerId: ProviderId; model: string; effort?: EffortLevel } = {
    providerId: nextProvider,
    model: '',
  }
  // If the current effort isn't in the new provider's supported set, snap
  // to its first option (usually 'auto') so the select doesn't sit on a
  // value the dropdown can't render.
  const supportedEfforts = EFFORTS_BY_PROVIDER[nextProvider] ?? EFFORT_LEVELS
  if (!supportedEfforts.includes(effectiveEffort.value)) {
    patch.effort = supportedEfforts[0] ?? 'auto'
  }
  void persistRuntime(patch)
}

function onModelChange(value: string) {
  void persistRuntime({ model: value })
}

function onEffortChange(value: string) {
  if (!(EFFORT_LEVELS as readonly string[]).includes(value)) return
  void persistRuntime({ effort: value as EffortLevel })
}

</script>

<style scoped>
.adp {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

/* ── Left list ── */
.adp-list {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.adp-item {
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 100ms, border-color 100ms;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.adp-item:hover { background: var(--surface-2); }
.adp-item.selected {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}
.adp-item.custom { border-color: color-mix(in srgb, var(--accent) 25%, var(--border)); }

.adp-item-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.adp-item-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  border: 1px solid var(--accent);
  color: var(--accent);
  align-self: flex-start;
}

.adp-item-desc {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.adp-item-runtime {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-muted);
}
.adp-item-runtime > span {
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.adp-item-runtime-provider {
  color: var(--text);
  font-weight: 500;
}
.adp-item-runtime-effort {
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.adp-item-types {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 2px;
}

.adp-chip {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-muted);
  white-space: nowrap;
}
.adp-item.selected .adp-chip {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  color: var(--accent);
}

/* ── Right content ── */
.adp-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.adp-content-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.adp-content-meta { flex: 1; min-width: 0; }

.adp-content-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 3px;
}

.adp-content-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.4;
}

.adp-toggle {
  display: inline-flex;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
  flex-shrink: 0;
}

.adp-mode {
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  transition: background 100ms, color 100ms;
}
.adp-mode:hover { color: var(--text); }
.adp-mode.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 3px var(--shadow);
}

.adp-runtime {
  flex-shrink: 0;
  display: flex;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  align-items: flex-end;
}
.adp-runtime-warning {
  flex-shrink: 0;
  margin: 10px 16px 0;
  padding: 8px 12px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--warning) 12%, var(--surface-2));
  border: 1px solid color-mix(in srgb, var(--warning) 45%, var(--border));
  color: var(--text);
  font-size: 12px;
  line-height: 1.45;
}
.adp-runtime-warning strong { color: var(--warning); }
.adp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.adp-field-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.adp-field-warning {
  font-size: 11px;
  line-height: 1.4;
  color: var(--warning);
}
.adp-select,
.adp-input {
  font: inherit;
  font-size: 12px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  border-radius: 4px;
  min-width: 0;
  width: 100%;
}
.adp-select:focus,
.adp-input:focus {
  outline: none;
  border-color: var(--accent);
}
.adp-select:disabled,
.adp-input:disabled {
  opacity: 0.6;
}

.adp-preview {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text);
}
.adp-preview :deep(h1),
.adp-preview :deep(h2),
.adp-preview :deep(h3) { font-weight: 600; margin: 1em 0 0.4em; color: var(--text); }
.adp-preview :deep(h2) { font-size: 13px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
.adp-preview :deep(p) { margin: 0 0 0.75em; }
.adp-preview :deep(ul), .adp-preview :deep(ol) { margin: 0 0 0.75em; padding-left: 20px; }
.adp-preview :deep(li) { margin-bottom: 2px; }
.adp-preview :deep(code) { background: var(--surface-2); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.adp-preview :deep(pre) { background: var(--surface-2); padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
.adp-preview :deep(pre code) { background: none; padding: 0; }
.adp-preview :deep(strong) { font-weight: 600; }
.adp-preview :deep(.adp-empty-hint) { color: var(--text-muted); font-style: italic; }

.adp-editor {
  flex: 1;
  min-height: 0;
  display: flex;
}

.adp-save-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
  flex-shrink: 0;
}

.adp-save-ok {
  font-size: 12px;
  color: var(--success);
  font-weight: 500;
}

.adp-save-btn {
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 16px;
  border-radius: 5px;
  background: var(--accent);
  color: var(--text-on-accent);
  border: 1px solid var(--accent);
  cursor: pointer;
  transition: background 120ms;
}
.adp-save-btn:hover:not(:disabled) { background: var(--accent-hover); }
.adp-save-btn:disabled { opacity: 0.6; cursor: default; }

.adp-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-muted);
  padding: 24px;
  text-align: center;
}
</style>
