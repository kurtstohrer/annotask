<template>
  <div class="aqs">
    <div class="aqs-row">
      <label class="aqs-field">
        <span>Agent</span>
        <select :value="activeProvider" @change="onProviderChange(($event.target as HTMLSelectElement).value)">
          <option v-for="p in primaryProviders" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>

      <label class="aqs-field">
        <span>Model</span>
        <!-- When the live probe returns a real list (or a static catalog
             exists), show the dropdown. When it doesn't — Copilot CLI is
             the canonical case; the CLI's `/model` picker is interactive
             only — drop to a plain text input so the user can type any id
             their account supports. Empty = Auto (CLI default). -->
        <select
          v-if="!modelsBlocked"
          :value="currentModel"
          :disabled="modelsLoading"
          data-testid="aqs-engine-model"
          @change="onModelChange(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
          <option v-if="currentModel && !models.some(m => m.id === currentModel)" :value="currentModel">
            {{ currentModel }} (custom)
          </option>
        </select>
        <input
          v-else
          type="text"
          :value="currentModel"
          placeholder="Auto (CLI default)"
          data-testid="aqs-engine-model-manual"
          @change="onModelChange(($event.target as HTMLInputElement).value.trim())"
        />
        <span
          v-if="modelsBlocked"
          class="aqs-field-warning"
          role="alert"
          data-testid="aqs-engine-model-blocked"
        >
          <strong>Cannot fetch models.</strong>
          {{ modelCatalog.error || 'The live probe returned nothing.' }}
          Defaulting to Auto — type a custom id above to override.
        </span>
      </label>

      <label class="aqs-field">
        <span>Effort</span>
        <select :value="currentEffort" @change="onEffortChange(($event.target as HTMLSelectElement).value)">
          <option v-for="e in effortOptions" :key="e" :value="e">{{ e }}</option>
        </select>
      </label>
    </div>

    <div class="aqs-row aqs-mode-row">
      <span class="aqs-field-label">Mode</span>
      <div class="aqs-mode-group" role="radiogroup" aria-label="Agent mode">
        <button
          v-for="m in modeOptions"
          :key="m.id"
          type="button"
          role="radio"
          :aria-checked="agentMode === m.id"
          :class="['aqs-mode-btn', { active: agentMode === m.id }]"
          @click="setAgentMode(m.id)">
          {{ m.label }}
        </button>
      </div>
      <span class="aqs-mode-hint">{{ modeHints[agentMode] }}</span>
    </div>

    <p :class="['aqs-status', readiness.tone]" v-if="readiness.message">
      <span class="aqs-status-dot" aria-hidden="true" />
      {{ readiness.message }}
    </p>

    <p v-if="activeProvider === 'claude-local'" class="aqs-note" data-testid="claude-local-billing-note">
      Heads up: on Pro/Max plans, Annotask runs Claude Code in headless mode and
      (from 2026-06-15) draws from your <strong>Agent SDK credit pool</strong> —
      separate from your interactive session limit. Pick <em>Anthropic</em> in
      Advanced if you'd rather bill an API key directly.
      <a
        href="https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan"
        target="_blank"
        rel="noopener"
      >Details</a>.
    </p>

    <details class="aqs-advanced">
      <summary>Advanced settings</summary>
      <p class="aqs-advanced-lead">
        API keys for HTTP providers, reasoning effort, redaction toggles, and
        extra CLI args live here. The defaults above cover most setups.
      </p>
      <ProviderSettingsPanel />
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import ProviderSettingsPanel from './ProviderSettingsPanel.vue'
import { useProviderSettings } from '../composables/useProviderSettings'
import { useAgentDetect, fetchAgentDetect } from '../composables/useTaskThread'
import { useAgentModels } from '../composables/useAgentModels'
import {
  EFFORTS_BY_PROVIDER,
  EFFORT_LEVELS,
  type AgentMode,
  type EffortLevel,
  type ProviderConfig,
  type ProviderId,
} from '../../embedded/provider-config'

// Primary providers — the visible CLI surface. Anthropic / OpenAI /
// OpenRouter / Compatible / Paperclip stay reachable via Advanced below.
// Copilot is wired to the `copilot-local` CLI subprocess only — the prior
// HTTP/OAuth `'copilot'` provider was removed because its
// `/copilot_internal/v2/token` endpoint is gated on the IDE-extension OAuth
// app and rejects every other token shape.
const PRIMARY: Array<{ id: ProviderId; label: string }> = [
  { id: 'claude-local', label: 'Claude' },
  { id: 'codex-local', label: 'Codex' },
  { id: 'opencode-local', label: 'OpenCode' },
  { id: 'copilot-local', label: 'Copilot' },
]

const primaryProviders = PRIMARY

const store = useProviderSettings()
const detect = useAgentDetect()
const agentModels = useAgentModels()

const activeProvider = computed(() => store.activeProvider.value)
const agentMode = computed<AgentMode>(() => store.settings.value.agentMode)
const currentModel = computed(() => store.settings.value.providers[activeProvider.value].model ?? '')
const currentEffort = computed(() => store.settings.value.providers[activeProvider.value].effort ?? 'auto')
const effortOptions = computed<readonly EffortLevel[]>(() => EFFORTS_BY_PROVIDER[activeProvider.value] ?? EFFORT_LEVELS)

// Model dropdown — sourced from the singleton catalog. There is no curated
// fallback: when the live probe returns nothing the dropdown reduces to
// "Auto (CLI default)" and a warning links users to the Advanced panel where
// they can enter a custom model id explicitly.
const modelCatalog = computed(() => agentModels.catalogFor(activeProvider.value).value)
const models = computed(() => modelCatalog.value.models)
const modelsLoading = computed(() => agentModels.state.loading[activeProvider.value] === true)
const modelsBlocked = computed(
  () => !modelsLoading.value && models.value.length <= 1 && !modelCatalog.value.discovered,
)

const modeOptions: Array<{ id: AgentMode; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'manual', label: 'Manual' },
  { id: 'off', label: 'Off' },
]

const modeHints: Record<AgentMode, string> = {
  auto: 'Tasks auto-run on create — hands-free.',
  manual: 'Conversation tab available; agent runs when you click Run.',
  off: 'No in-shell chat; drive agents from the terminal instead.',
}

const readiness = computed<{ message: string; tone: 'success' | 'muted' | 'danger' }>(() => {
  const id = activeProvider.value
  const snap = detect.snapshot.value
  if (id === 'claude-local' || id === 'codex-local' || id === 'opencode-local' || id === 'copilot-local') {
    if (!snap) return { message: 'Detecting local CLI…', tone: 'muted' }
    const probe = snap[id]
    if (!probe?.found) return { message: `${PRIMARY.find(p => p.id === id)?.label} CLI not installed.`, tone: 'danger' }
    if (!probe?.loggedIn) return { message: `${PRIMARY.find(p => p.id === id)?.label} CLI installed but not logged in. Run \`${id.replace('-local', '')} login\` in a terminal.`, tone: 'danger' }
    return { message: `${PRIMARY.find(p => p.id === id)?.label} (local CLI) ready.`, tone: 'success' }
  }
  return { message: '', tone: 'muted' }
})

function onProviderChange(value: string) {
  store.setActiveProvider(value as ProviderId)
}

function onModelChange(value: string) {
  store.setModel(activeProvider.value, value)
}

function onEffortChange(value: string) {
  store.setEffort(activeProvider.value, value as EffortLevel)
}

function setAgentMode(mode: AgentMode) {
  store.setAgentMode(mode)
}

onMounted(() => {
  fetchAgentDetect()
  void agentModels.ensure(activeProvider.value)
  // Ensure the model field starts at Auto ('') for the initial provider.
  // If the user previously saved a specific model it stays; if not set,
  // the empty string matches the "Auto (CLI default)" option.
  const initial = store.settings.value.providers[activeProvider.value] as ProviderConfig
  if (!initial.model) store.setModel(activeProvider.value, '')
})

watch(activeProvider, (id) => {
  void agentModels.ensure(id)
  // Always reset to Auto when the user switches provider — the model
  // from the previous provider is meaningless for the new one.
  store.setModel(id, '')
})

// When the picker enters the "Cannot fetch models" state and the user has
// a stale model id saved, default that input back to Auto (empty) so the
// blocked-state UI starts clean instead of pre-filling a value the live
// probe couldn't confirm.
watch(modelsBlocked, (blocked) => {
  if (!blocked) return
  if (!currentModel.value) return
  store.setModel(activeProvider.value, '')
})
</script>

<style scoped>
.aqs {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.aqs-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.aqs-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}
.aqs-field > span:first-child { font-weight: 600; color: var(--text); }

.aqs-field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  align-self: center;
}

.aqs-field select,
.aqs-field input[type="text"] {
  font: inherit;
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
.aqs-field select:disabled { opacity: 0.6; cursor: progress; }
.aqs-field input[type="text"]:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }

.aqs-field-warning {
  font-size: 11px;
  line-height: 1.4;
  color: var(--warning);
}

.aqs-mode-row {
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
}

.aqs-mode-group {
  display: inline-flex;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
}

.aqs-mode-btn {
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 14px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
}
.aqs-mode-btn:hover:not(.active) { color: var(--text); }
.aqs-mode-btn.active {
  background: var(--accent);
  color: var(--text-on-accent);
}

.aqs-mode-hint {
  font-size: 11px;
  color: var(--text-muted);
  text-align: right;
  flex-basis: 100%;
}

.aqs-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin: 0;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.aqs-status.success { color: var(--success); }
.aqs-status.danger { color: var(--danger); }
.aqs-status.muted { color: var(--text-muted); }

.aqs-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.aqs-note {
  margin: 0;
  padding: 8px 12px;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--text-muted);
  background: color-mix(in srgb, var(--info) 8%, var(--surface-2));
  border: 1px solid color-mix(in srgb, var(--info) 35%, var(--border));
  border-radius: 6px;
}
.aqs-note strong { color: var(--text); }
.aqs-note a { color: var(--text-link); }

.aqs-advanced {
  margin-top: 4px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.aqs-advanced summary {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 0;
}
.aqs-advanced summary:hover { color: var(--text); }
.aqs-advanced[open] summary { color: var(--text); margin-bottom: 8px; }
.aqs-advanced-lead {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0 0 10px;
}
</style>
