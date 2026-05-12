<script setup lang="ts">
/**
 * Provider settings panel — M4 storage + validation surface.
 *
 * Owner: AICoder (this file). DesignEngineer owns the visual polish; the
 * markup is intentionally plain so the styling pass can happen without
 * fighting hand-tuned class names. Field names map 1:1 to
 * `useProviderSettings()` and the `provider-config` schema, so renaming a
 * label here never silently breaks storage.
 */
import { computed, ref } from 'vue'
import { useProviderSettings } from '../composables/useProviderSettings'
import { validateProviderConfig } from '../../embedded/provider-config'
import type { ProviderId } from '../../embedded/provider-config'

const store = useProviderSettings()

const settings = store.settings
const active = computed<ProviderId>(() => settings.value.activeProvider)

const providerLabels: Record<ProviderId, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI / Codex',
  'openai-compatible': 'OpenAI-compatible (opencode, Ollama, …)',
  copilot: 'GitHub Copilot',
  paperclip: 'Paperclip',
}

const capInput = ref(String(settings.value.perConversationCapUsd))

const validationErrors = ref<string[]>([])
const validationOk = ref(false)

function setProvider(id: ProviderId) {
  store.setActiveProvider(id)
  validationErrors.value = []
  validationOk.value = false
}

function onValidate() {
  const current = settings.value.providers[active.value]
  const result = validateProviderConfig(current)
  if (result.ok) {
    validationErrors.value = []
    validationOk.value = true
  } else {
    validationErrors.value = result.errors
    validationOk.value = false
  }
}

function onCapInput(e: Event) {
  const next = Number.parseFloat((e.target as HTMLInputElement).value)
  if (Number.isFinite(next) && next > 0) {
    store.setCap(next)
  }
  capInput.value = (e.target as HTMLInputElement).value
}

function onClearEventLog() {
  store.eventLog.clear()
}
</script>

<template>
  <div class="provider-panel">
    <section class="ps-section" aria-label="Provider selection">
      <h3 class="ps-title">Provider</h3>
      <p class="ps-desc">
        Choose which provider the embedded chat calls. Credentials stay in
        your browser — never sent to any Annotask server.
      </p>
      <div class="ps-tabs">
        <button
          v-for="id in store.providerIds"
          :key="id"
          type="button"
          class="ps-tab"
          :class="{ active: active === id }"
          :data-testid="`provider-tab-${id}`"
          @click="setProvider(id)"
        >
          {{ providerLabels[id] }}
        </button>
      </div>
    </section>

    <section v-if="active === 'anthropic'" class="ps-section" aria-label="Anthropic settings">
      <h4 class="ps-subtitle">Anthropic key</h4>
      <label class="ps-field">
        <span class="ps-label">API key</span>
        <input
          type="password"
          class="ps-input"
          autocomplete="off"
          spellcheck="false"
          placeholder="sk-ant-…"
          :value="settings.providers.anthropic.apiKey"
          data-testid="anthropic-key"
          @input="(e) => store.setProviderConfig({ ...settings.providers.anthropic, apiKey: (e.target as HTMLInputElement).value })"
        />
      </label>
      <label class="ps-field">
        <span class="ps-label">Model</span>
        <input
          type="text"
          class="ps-input"
          :value="settings.providers.anthropic.model"
          @input="(e) => store.setProviderConfig({ ...settings.providers.anthropic, model: (e.target as HTMLInputElement).value })"
        />
      </label>
    </section>

    <section v-else-if="active === 'openai'" class="ps-section" aria-label="OpenAI settings">
      <h4 class="ps-subtitle">OpenAI / Codex key</h4>
      <label class="ps-field">
        <span class="ps-label">API key</span>
        <input
          type="password"
          class="ps-input"
          autocomplete="off"
          spellcheck="false"
          placeholder="sk-…"
          :value="settings.providers.openai.apiKey"
          data-testid="openai-key"
          @input="(e) => store.setProviderConfig({ ...settings.providers.openai, apiKey: (e.target as HTMLInputElement).value })"
        />
      </label>
      <label class="ps-field">
        <span class="ps-label">Organization (optional)</span>
        <input
          type="text"
          class="ps-input"
          :value="settings.providers.openai.organization"
          placeholder="org-…"
          @input="(e) => store.setProviderConfig({ ...settings.providers.openai, organization: (e.target as HTMLInputElement).value })"
        />
      </label>
      <label class="ps-field">
        <span class="ps-label">Model</span>
        <input
          type="text"
          class="ps-input"
          :value="settings.providers.openai.model"
          @input="(e) => store.setProviderConfig({ ...settings.providers.openai, model: (e.target as HTMLInputElement).value })"
        />
      </label>
    </section>

    <section
      v-else-if="active === 'openai-compatible'"
      class="ps-section"
      aria-label="OpenAI-compatible endpoint settings"
    >
      <h4 class="ps-subtitle">OpenAI-compatible endpoint</h4>
      <p class="ps-desc">opencode, Ollama, LM Studio, vLLM, …</p>
      <label class="ps-field">
        <span class="ps-label">Endpoint URL</span>
        <input
          type="text"
          class="ps-input"
          spellcheck="false"
          placeholder="http://localhost:4096/v1"
          :value="settings.providers['openai-compatible'].endpointUrl"
          data-testid="oai-compat-endpoint"
          @input="(e) => store.setProviderConfig({ ...settings.providers['openai-compatible'], endpointUrl: (e.target as HTMLInputElement).value })"
        />
      </label>
      <label class="ps-field">
        <span class="ps-label">API key (optional)</span>
        <input
          type="password"
          class="ps-input"
          autocomplete="off"
          :value="settings.providers['openai-compatible'].apiKey"
          @input="(e) => store.setProviderConfig({ ...settings.providers['openai-compatible'], apiKey: (e.target as HTMLInputElement).value })"
        />
      </label>
      <label class="ps-field">
        <span class="ps-label">Model</span>
        <input
          type="text"
          class="ps-input"
          :value="settings.providers['openai-compatible'].model"
          @input="(e) => store.setProviderConfig({ ...settings.providers['openai-compatible'], model: (e.target as HTMLInputElement).value })"
        />
      </label>
      <label class="ps-field">
        <span class="ps-label">Label</span>
        <input
          type="text"
          class="ps-input"
          :value="settings.providers['openai-compatible'].label"
          placeholder="opencode local"
          @input="(e) => store.setProviderConfig({ ...settings.providers['openai-compatible'], label: (e.target as HTMLInputElement).value })"
        />
      </label>
    </section>

    <section v-else-if="active === 'copilot'" class="ps-section" aria-label="Copilot settings">
      <h4 class="ps-subtitle">GitHub Copilot</h4>
      <p class="ps-desc">
        Sign in once with the device-code flow; we store the OAuth access
        token locally. <em>Sign-in flow lands with M1 (ANN-16).</em>
      </p>
      <label class="ps-field">
        <span class="ps-label">OAuth token</span>
        <input
          type="password"
          class="ps-input"
          autocomplete="off"
          :value="settings.providers.copilot.oauthToken"
          data-testid="copilot-token"
          @input="(e) => store.setProviderConfig({ ...settings.providers.copilot, oauthToken: (e.target as HTMLInputElement).value })"
        />
      </label>
      <label class="ps-field">
        <span class="ps-label">Model</span>
        <input
          type="text"
          class="ps-input"
          :value="settings.providers.copilot.model"
          @input="(e) => store.setProviderConfig({ ...settings.providers.copilot, model: (e.target as HTMLInputElement).value })"
        />
      </label>
    </section>

    <section v-else-if="active === 'paperclip'" class="ps-section" aria-label="Paperclip settings">
      <h4 class="ps-subtitle">Paperclip company</h4>
      <label class="ps-field">
        <span class="ps-label">Company ID</span>
        <input
          type="text"
          class="ps-input"
          spellcheck="false"
          :value="settings.providers.paperclip.companyId"
          @input="(e) => store.setProviderConfig({ ...settings.providers.paperclip, companyId: (e.target as HTMLInputElement).value })"
        />
      </label>
      <label class="ps-field">
        <span class="ps-label">API key</span>
        <input
          type="password"
          class="ps-input"
          autocomplete="off"
          :value="settings.providers.paperclip.apiKey"
          data-testid="paperclip-key"
          @input="(e) => store.setProviderConfig({ ...settings.providers.paperclip, apiKey: (e.target as HTMLInputElement).value })"
        />
      </label>
      <label class="ps-field">
        <span class="ps-label">API base URL (optional)</span>
        <input
          type="text"
          class="ps-input"
          spellcheck="false"
          placeholder="https://api.paperclip.ing"
          :value="settings.providers.paperclip.apiBaseUrl"
          @input="(e) => store.setProviderConfig({ ...settings.providers.paperclip, apiBaseUrl: (e.target as HTMLInputElement).value })"
        />
      </label>
    </section>

    <section class="ps-section" aria-label="Validation">
      <button type="button" class="ps-btn" data-testid="validate-provider" @click="onValidate">
        Validate current provider
      </button>
      <p v-if="validationOk" class="ps-ok" role="status">Configuration looks good.</p>
      <ul v-if="validationErrors.length > 0" class="ps-errors" role="alert">
        <li v-for="err in validationErrors" :key="err">{{ err }}</li>
      </ul>
    </section>

    <section class="ps-section" aria-label="Budget cap">
      <h4 class="ps-subtitle">Per-conversation budget cap</h4>
      <p class="ps-desc">
        The chat loop hard-stops when this conversation's running total crosses
        the cap.
      </p>
      <label class="ps-field ps-field-inline">
        <span class="ps-label">Cap (USD)</span>
        <input
          type="number"
          min="0.01"
          step="0.05"
          class="ps-input ps-input-narrow"
          :value="capInput"
          data-testid="provider-cap-usd"
          @input="onCapInput"
        />
      </label>
    </section>

    <section class="ps-section" aria-label="Guardrails">
      <h4 class="ps-subtitle">Guardrails</h4>
      <label class="ps-toggle">
        <input
          type="checkbox"
          :checked="settings.redactionEnabled"
          data-testid="redaction-enabled"
          @change="(e) => store.setRedactionEnabled((e.target as HTMLInputElement).checked)"
        />
        <span>Redact common secret patterns before sending to provider</span>
      </label>
      <label class="ps-toggle">
        <input
          type="checkbox"
          :checked="settings.eventLogEnabled"
          data-testid="event-log-enabled"
          @change="(e) => store.setEventLogEnabled((e.target as HTMLInputElement).checked)"
        />
        <span>Record local-only event log (provider, model, tokens, latency)</span>
      </label>
      <button
        type="button"
        class="ps-btn ps-btn-ghost"
        data-testid="clear-event-log"
        @click="onClearEventLog"
      >
        Clear event log
      </button>
    </section>
  </div>
</template>

<style scoped>
.provider-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 640px;
}

.ps-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ps-title {
  font-size: 13px;
  font-weight: 700;
  margin: 0;
}

.ps-subtitle {
  font-size: 12px;
  font-weight: 700;
  margin: 0;
}

.ps-desc {
  font-size: 11.5px;
  color: var(--text-muted, #888);
  margin: 0;
  line-height: 1.5;
}

.ps-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ps-tab {
  padding: 6px 10px;
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid var(--border, #333);
  background: var(--surface-2, #1a1a1a);
  color: var(--text, #ddd);
  border-radius: 6px;
  cursor: pointer;
}

.ps-tab:hover { border-color: var(--accent, #88aaff); }
.ps-tab.active {
  background: var(--accent, #88aaff);
  color: var(--text-on-accent, #000);
  border-color: var(--accent, #88aaff);
}

.ps-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ps-field-inline { flex-direction: row; align-items: center; gap: 10px; }

.ps-label {
  font-size: 11px;
  font-weight: 600;
}

.ps-input {
  font-size: 12.5px;
  padding: 6px 8px;
  background: var(--surface-2, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  color: var(--text, #ddd);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.ps-input:focus { outline: none; border-color: var(--accent, #88aaff); }
.ps-input-narrow { width: 100px; }

.ps-btn {
  align-self: flex-start;
  padding: 6px 12px;
  font-size: 11.5px;
  font-weight: 600;
  background: var(--accent, #88aaff);
  color: var(--text-on-accent, #000);
  border: 1px solid var(--accent, #88aaff);
  border-radius: 6px;
  cursor: pointer;
}
.ps-btn-ghost {
  background: var(--surface-2, #1a1a1a);
  color: var(--text, #ddd);
}

.ps-ok {
  font-size: 11px;
  color: #4ec98a;
  margin: 0;
}

.ps-errors {
  list-style: disc inside;
  font-size: 11px;
  color: #d97c7c;
  margin: 0;
  padding-left: 4px;
}

.ps-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  cursor: pointer;
}
</style>
