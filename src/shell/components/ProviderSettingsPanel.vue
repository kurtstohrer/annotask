<script setup lang="ts">
/**
 * Provider settings panel — M4 storage + validation surface.
 *
 * Field names map 1:1 to `useProviderSettings()` and the `provider-config`
 * schema, so renaming a label here never silently breaks storage.
 *
 * Visual language matches `AISettingsPanel.vue` so users feel a single
 * settings system, not two stitched-together panels. The provider strip
 * uses the same flat-pill treatment as the model picker.
 */
import { computed, reactive, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { useProviderSettings } from '../composables/useProviderSettings'
import { validateProviderConfig } from '../../embedded/provider-config'
import type { ProviderConfig, ProviderId } from '../../embedded/provider-config'

const store = useProviderSettings()

const settings = store.settings
const active = computed<ProviderId>(() => settings.value.activeProvider)

const providerMeta: Record<
  ProviderId,
  { label: string; short: string; tagline: string }
> = {
  anthropic: {
    label: 'Anthropic',
    short: 'Anthropic',
    tagline: 'Claude — BYOK',
  },
  openai: {
    label: 'OpenAI / Codex',
    short: 'OpenAI',
    tagline: 'GPT family — BYOK',
  },
  'openai-compatible': {
    label: 'OpenAI-compatible',
    short: 'Compatible',
    tagline: 'opencode · Ollama · LM Studio · vLLM',
  },
  copilot: {
    label: 'GitHub Copilot',
    short: 'Copilot',
    tagline: 'Sign in with GitHub',
  },
  paperclip: {
    label: 'Paperclip',
    short: 'Paperclip',
    tagline: 'Managed inference for your company',
  },
}

const capInput = ref(String(settings.value.perConversationCapUsd))

// Per-field validation errors, keyed by the schema path (e.g. "apiKey",
// "endpointUrl"). Recomputed whenever the active provider's config changes
// so users see issues inline as they type, not at the bottom of the panel.
const fieldErrors = reactive<Record<string, string[]>>({})
const generalErrors = ref<string[]>([])
const valid = ref(false)

function runValidation() {
  const current = settings.value.providers[active.value]
  const result = validateProviderConfig(current)
  // Reset previous errors before applying the fresh result.
  for (const k of Object.keys(fieldErrors)) delete fieldErrors[k]
  generalErrors.value = []
  if (result.ok) {
    valid.value = true
    return
  }
  valid.value = false
  // Bucket each issue by its leaf field name. Validation errors without a
  // path (rare) bubble up to a single panel-level row.
  const detailed = result.errors
  detailed.forEach((line) => {
    const [path, ...rest] = line.split(': ')
    if (rest.length === 0) {
      generalErrors.value.push(path)
      return
    }
    const message = rest.join(': ')
    if (!fieldErrors[path]) fieldErrors[path] = []
    fieldErrors[path].push(message)
  })
}

// Validate immediately on mount and whenever the user edits the active
// provider's config. Switching providers triggers a fresh validation pass
// against the new branch.
watch(
  () => settings.value.providers[active.value],
  () => runValidation(),
  { deep: true, immediate: true },
)
watch(active, () => runValidation())

function setProvider(id: ProviderId) {
  store.setActiveProvider(id)
}

// Merge a partial patch onto the named provider branch and persist it. We
// rely on the discriminated-union `id` field at runtime; the cast covers
// TS's inability to narrow the generic by literal `id` from the call site.
function patchProvider(patch: { id: ProviderId } & Record<string, unknown>) {
  const current = settings.value.providers[patch.id]
  store.setProviderConfig({ ...current, ...patch } as ProviderConfig)
}

function onCapInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  capInput.value = raw
  const next = Number.parseFloat(raw)
  if (Number.isFinite(next) && next > 0) store.setCap(next)
}

function onClearEventLog() {
  store.eventLog.clear()
}

function fieldError(name: string): string | null {
  const list = fieldErrors[name]
  return list && list.length > 0 ? list[0] : null
}

// Reveal toggles per secret field, keyed by stable field id.
const revealed = reactive<Record<string, boolean>>({})
function toggleReveal(key: string) {
  revealed[key] = !revealed[key]
}
function inputType(key: string): 'text' | 'password' {
  return revealed[key] ? 'text' : 'password'
}

const copilotSignedIn = computed(
  () => settings.value.providers.copilot.oauthToken.trim().length > 0,
)
const paperclipConnected = computed(() => {
  const p = settings.value.providers.paperclip
  return p.apiKey.trim().length > 0 && p.companyId.trim().length > 0
})

function readinessTone(ready: boolean): 'success' | 'muted' {
  return ready ? 'success' : 'muted'
}
const activeReady = computed(() => store.ready.value)
</script>

<template>
  <div class="ai-panel provider-panel">
    <!-- Flat horizontal pill strip — same visual weight as the model picker
         so the panel reads as one screen with a branch selector. -->
    <section class="ai-section">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Provider</h3>
        <p class="ai-section-desc">
          Choose which provider the embedded chat calls. Credentials stay in
          your browser — never sent to any Annotask server.
        </p>
      </div>
      <div class="provider-pills" role="tablist" aria-label="Active provider">
        <button
          v-for="id in store.providerIds"
          :key="id"
          type="button"
          role="tab"
          :aria-selected="active === id"
          :tabindex="active === id ? 0 : -1"
          class="provider-pill"
          :class="{ active: active === id }"
          :data-testid="`provider-tab-${id}`"
          @click="setProvider(id)"
        >
          <span class="provider-pill-name">{{ providerMeta[id].short }}</span>
        </button>
      </div>
      <p class="provider-tagline">{{ providerMeta[active].tagline }}</p>

      <div
        class="ai-validation"
        :class="`tone-${readinessTone(activeReady)}`"
        data-testid="provider-readiness"
      >
        <Icon :name="activeReady ? 'check' : 'info'" :size="12" />
        <span v-if="activeReady">{{ providerMeta[active].label }} is configured and ready.</span>
        <span v-else>Add credentials below to start using {{ providerMeta[active].label }}.</span>
      </div>
    </section>

    <!-- Anthropic — BYOK -->
    <section v-if="active === 'anthropic'" class="ai-section" aria-label="Anthropic settings">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Anthropic key</h3>
        <p class="ai-section-desc">
          Used for any Claude model selected below. Same storage path as the
          AI tab — pasting a key in either place updates both.
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-anthropic-key">API key</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('apiKey') }">
          <input
            id="prov-anthropic-key"
            class="ai-input"
            :type="inputType('anthropic-key')"
            :value="settings.providers.anthropic.apiKey"
            placeholder="sk-ant-…"
            spellcheck="false"
            autocomplete="off"
            data-testid="anthropic-key"
            @input="patchProvider({ id: 'anthropic', apiKey: ($event.target as HTMLInputElement).value })"
          />
          <button
            type="button"
            class="ai-icon-btn"
            :title="revealed['anthropic-key'] ? 'Hide key' : 'Reveal key'"
            @click="toggleReveal('anthropic-key')"
          >
            <Icon :name="revealed['anthropic-key'] ? 'x' : 'lock'" :size="13" />
          </button>
        </div>
        <p v-if="fieldError('apiKey')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('apiKey') }}</span>
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-anthropic-model">Model</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('model') }">
          <input
            id="prov-anthropic-model"
            class="ai-input"
            type="text"
            :value="settings.providers.anthropic.model"
            spellcheck="false"
            @input="patchProvider({ id: 'anthropic', model: ($event.target as HTMLInputElement).value })"
          />
        </div>
        <p v-if="fieldError('model')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('model') }}</span>
        </p>
      </div>
    </section>

    <!-- OpenAI / Codex — BYOK -->
    <section v-else-if="active === 'openai'" class="ai-section" aria-label="OpenAI settings">
      <div class="ai-section-head">
        <h3 class="ai-section-title">OpenAI / Codex key</h3>
        <p class="ai-section-desc">Use a key from <code>platform.openai.com</code>. Org ID is optional.</p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-openai-key">API key</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('apiKey') }">
          <input
            id="prov-openai-key"
            class="ai-input"
            :type="inputType('openai-key')"
            :value="settings.providers.openai.apiKey"
            placeholder="sk-…"
            spellcheck="false"
            autocomplete="off"
            data-testid="openai-key"
            @input="patchProvider({ id: 'openai', apiKey: ($event.target as HTMLInputElement).value })"
          />
          <button
            type="button"
            class="ai-icon-btn"
            :title="revealed['openai-key'] ? 'Hide key' : 'Reveal key'"
            @click="toggleReveal('openai-key')"
          >
            <Icon :name="revealed['openai-key'] ? 'x' : 'lock'" :size="13" />
          </button>
        </div>
        <p v-if="fieldError('apiKey')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('apiKey') }}</span>
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-openai-org">Organization</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('organization') }">
          <input
            id="prov-openai-org"
            class="ai-input"
            type="text"
            placeholder="org-… (optional)"
            :value="settings.providers.openai.organization"
            spellcheck="false"
            @input="patchProvider({ id: 'openai', organization: ($event.target as HTMLInputElement).value })"
          />
        </div>
        <p v-if="fieldError('organization')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('organization') }}</span>
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-openai-model">Model</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('model') }">
          <input
            id="prov-openai-model"
            class="ai-input"
            type="text"
            :value="settings.providers.openai.model"
            spellcheck="false"
            @input="patchProvider({ id: 'openai', model: ($event.target as HTMLInputElement).value })"
          />
        </div>
        <p v-if="fieldError('model')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('model') }}</span>
        </p>
      </div>
    </section>

    <!-- OpenAI-compatible — endpoint URL is mandatory; preset hints in placeholder. -->
    <section
      v-else-if="active === 'openai-compatible'"
      class="ai-section"
      aria-label="OpenAI-compatible endpoint settings"
    >
      <div class="ai-section-head">
        <h3 class="ai-section-title">OpenAI-compatible endpoint</h3>
        <p class="ai-section-desc">
          For <strong>opencode</strong>, <strong>Ollama</strong>, <strong>LM Studio</strong>,
          <strong>vLLM</strong>, and similar. The endpoint URL is required; the
          API key may be empty for local servers.
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-oai-endpoint">Endpoint URL</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('endpointUrl') }">
          <input
            id="prov-oai-endpoint"
            class="ai-input"
            type="url"
            placeholder="http://localhost:4096/v1"
            :value="settings.providers['openai-compatible'].endpointUrl"
            spellcheck="false"
            data-testid="oai-compat-endpoint"
            @input="patchProvider({ id: 'openai-compatible', endpointUrl: ($event.target as HTMLInputElement).value })"
          />
        </div>
        <p v-if="fieldError('endpointUrl')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('endpointUrl') }}</span>
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-oai-key">API key</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('apiKey') }">
          <input
            id="prov-oai-key"
            class="ai-input"
            :type="inputType('oai-compat-key')"
            placeholder="optional"
            :value="settings.providers['openai-compatible'].apiKey"
            autocomplete="off"
            @input="patchProvider({ id: 'openai-compatible', apiKey: ($event.target as HTMLInputElement).value })"
          />
          <button
            type="button"
            class="ai-icon-btn"
            :title="revealed['oai-compat-key'] ? 'Hide key' : 'Reveal key'"
            @click="toggleReveal('oai-compat-key')"
          >
            <Icon :name="revealed['oai-compat-key'] ? 'x' : 'lock'" :size="13" />
          </button>
        </div>
        <p v-if="fieldError('apiKey')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('apiKey') }}</span>
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-oai-model">Model</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('model') }">
          <input
            id="prov-oai-model"
            class="ai-input"
            type="text"
            placeholder="e.g. llama3.1:70b, qwen2.5-coder"
            :value="settings.providers['openai-compatible'].model"
            spellcheck="false"
            @input="patchProvider({ id: 'openai-compatible', model: ($event.target as HTMLInputElement).value })"
          />
        </div>
        <p v-if="fieldError('model')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('model') }}</span>
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-oai-label">Label</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('label') }">
          <input
            id="prov-oai-label"
            class="ai-input"
            type="text"
            placeholder="opencode local"
            :value="settings.providers['openai-compatible'].label"
            @input="patchProvider({ id: 'openai-compatible', label: ($event.target as HTMLInputElement).value })"
          />
        </div>
        <p v-if="fieldError('label')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('label') }}</span>
        </p>
      </div>
    </section>

    <!-- Copilot — signed-in / signed-out empty state. -->
    <section v-else-if="active === 'copilot'" class="ai-section" aria-label="Copilot settings">
      <div class="ai-section-head">
        <h3 class="ai-section-title">GitHub Copilot</h3>
        <p class="ai-section-desc">
          Sign in once with the device-code flow. We store the OAuth access
          token locally — the same posture as <code>~/.config/gh-copilot</code>.
        </p>
      </div>

      <div v-if="!copilotSignedIn" class="ai-empty" data-testid="copilot-empty">
        <Icon name="lock" :size="18" />
        <div class="ai-empty-text">
          <p class="ai-empty-title">Not signed in</p>
          <p class="ai-empty-desc">
            Device-code OAuth lands with [ANN-16]. Until then, paste a token
            below if you already have one in <code>~/.config/gh-copilot</code>.
          </p>
        </div>
        <button
          type="button"
          class="ai-btn ai-btn-primary"
          disabled
          title="Coming with ANN-16"
        >
          <Icon name="lock" :size="12" />
          <span>Sign in to GitHub Copilot</span>
        </button>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-copilot-token">OAuth token</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('oauthToken') }">
          <input
            id="prov-copilot-token"
            class="ai-input"
            :type="inputType('copilot-token')"
            :value="settings.providers.copilot.oauthToken"
            autocomplete="off"
            placeholder="gho_…"
            data-testid="copilot-token"
            @input="patchProvider({ id: 'copilot', oauthToken: ($event.target as HTMLInputElement).value })"
          />
          <button
            type="button"
            class="ai-icon-btn"
            :title="revealed['copilot-token'] ? 'Hide token' : 'Reveal token'"
            @click="toggleReveal('copilot-token')"
          >
            <Icon :name="revealed['copilot-token'] ? 'x' : 'lock'" :size="13" />
          </button>
        </div>
        <p v-if="fieldError('oauthToken')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('oauthToken') }}</span>
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-copilot-model">Model</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('model') }">
          <input
            id="prov-copilot-model"
            class="ai-input"
            type="text"
            :value="settings.providers.copilot.model"
            spellcheck="false"
            @input="patchProvider({ id: 'copilot', model: ($event.target as HTMLInputElement).value })"
          />
        </div>
        <p v-if="fieldError('model')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('model') }}</span>
        </p>
      </div>
    </section>

    <!-- Paperclip — connected / not-connected empty state. -->
    <section v-else-if="active === 'paperclip'" class="ai-section" aria-label="Paperclip settings">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Paperclip company</h3>
        <p class="ai-section-desc">
          Use managed inference billed against a Paperclip company. Generate a
          key with <code>pnpm paperclipai connect</code>.
        </p>
      </div>

      <div v-if="!paperclipConnected" class="ai-empty" data-testid="paperclip-empty">
        <Icon name="package" :size="18" />
        <div class="ai-empty-text">
          <p class="ai-empty-title">No company connected</p>
          <p class="ai-empty-desc">
            Paste your company ID and API key below. Self-hosted instances can
            override the API base URL.
          </p>
        </div>
        <a
          class="ai-btn ai-btn-primary"
          href="https://paperclip.ing/docs/connect"
          target="_blank"
          rel="noopener"
        >
          <Icon name="arrow-right" :size="12" />
          <span>Connect Paperclip company</span>
        </a>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-paperclip-company">Company ID</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('companyId') }">
          <input
            id="prov-paperclip-company"
            class="ai-input"
            type="text"
            spellcheck="false"
            placeholder="cmp_…"
            :value="settings.providers.paperclip.companyId"
            @input="patchProvider({ id: 'paperclip', companyId: ($event.target as HTMLInputElement).value })"
          />
        </div>
        <p v-if="fieldError('companyId')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('companyId') }}</span>
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-paperclip-key">API key</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('apiKey') }">
          <input
            id="prov-paperclip-key"
            class="ai-input"
            :type="inputType('paperclip-key')"
            :value="settings.providers.paperclip.apiKey"
            autocomplete="off"
            placeholder="pcl_…"
            data-testid="paperclip-key"
            @input="patchProvider({ id: 'paperclip', apiKey: ($event.target as HTMLInputElement).value })"
          />
          <button
            type="button"
            class="ai-icon-btn"
            :title="revealed['paperclip-key'] ? 'Hide key' : 'Reveal key'"
            @click="toggleReveal('paperclip-key')"
          >
            <Icon :name="revealed['paperclip-key'] ? 'x' : 'lock'" :size="13" />
          </button>
        </div>
        <p v-if="fieldError('apiKey')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('apiKey') }}</span>
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-paperclip-base">API base URL</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('apiBaseUrl') }">
          <input
            id="prov-paperclip-base"
            class="ai-input"
            type="url"
            spellcheck="false"
            placeholder="https://api.paperclip.ing (optional)"
            :value="settings.providers.paperclip.apiBaseUrl"
            @input="patchProvider({ id: 'paperclip', apiBaseUrl: ($event.target as HTMLInputElement).value })"
          />
        </div>
        <p v-if="fieldError('apiBaseUrl')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('apiBaseUrl') }}</span>
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="prov-paperclip-model">Model</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('model') }">
          <input
            id="prov-paperclip-model"
            class="ai-input"
            type="text"
            :value="settings.providers.paperclip.model"
            spellcheck="false"
            @input="patchProvider({ id: 'paperclip', model: ($event.target as HTMLInputElement).value })"
          />
        </div>
        <p v-if="fieldError('model')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('model') }}</span>
        </p>
      </div>
    </section>

    <!-- Generic / non-field validation issues (rare but possible). -->
    <div
      v-if="generalErrors.length > 0"
      class="ai-validation tone-danger"
      role="alert"
      data-testid="provider-general-errors"
    >
      <Icon name="triangle-alert" :size="12" />
      <span>{{ generalErrors.join(' · ') }}</span>
    </div>

    <!-- Per-conversation cost cap (parity with AI tab). -->
    <section class="ai-section" aria-label="Per-conversation budget cap">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Per-conversation cost cap</h3>
        <p class="ai-section-desc">
          The chat loop hard-stops when this conversation's running total
          crosses the cap.
        </p>
      </div>
      <div class="ai-field ai-field-inline">
        <label class="ai-label" for="prov-cap">Cap (USD)</label>
        <div class="ai-input-row ai-input-row-narrow">
          <span class="ai-prefix">$</span>
          <input
            id="prov-cap"
            class="ai-input ai-input-narrow"
            type="number"
            min="0.01"
            step="0.05"
            :value="capInput"
            data-testid="provider-cap-usd"
            @input="onCapInput"
          />
        </div>
      </div>
    </section>

    <!-- Guardrails: redaction + local event log. -->
    <section class="ai-section" aria-label="Guardrails">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Guardrails</h3>
        <p class="ai-section-desc">
          Defaults are on. The event log is local-only — nothing leaves your
          browser.
        </p>
      </div>

      <label class="ai-toggle">
        <input
          type="checkbox"
          :checked="settings.redactionEnabled"
          data-testid="redaction-enabled"
          @change="store.setRedactionEnabled(($event.target as HTMLInputElement).checked)"
        />
        <span>Redact common secret patterns before sending to provider</span>
      </label>

      <label class="ai-toggle">
        <input
          type="checkbox"
          :checked="settings.eventLogEnabled"
          data-testid="event-log-enabled"
          @change="store.setEventLogEnabled(($event.target as HTMLInputElement).checked)"
        />
        <span>Record local-only event log (provider, model, tokens, latency)</span>
      </label>

      <div class="ai-actions">
        <button
          type="button"
          class="ai-btn ai-btn-ghost"
          data-testid="clear-event-log"
          @click="onClearEventLog"
        >
          Clear event log
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.provider-panel { gap: 24px; }

.provider-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.provider-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.005em;
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
}

.provider-pill:hover { border-color: var(--text-muted); }
.provider-pill:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.provider-pill.active {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}

.provider-pill-name { line-height: 1; }

.provider-tagline {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

/* Inline per-field error row. Visually echoes the validation tones used by
   AISettingsPanel so users learn one error grammar across the sheet. */
.ai-field-error {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--danger);
  margin: 0;
  line-height: 1.4;
}

.ai-input-row.tone-danger {
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 8%, var(--surface-2));
}

/* Empty-state CTA — used for Copilot sign-in and Paperclip connect. */
.ai-empty {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--accent) 6%, var(--surface-2));
  border: 1px dashed color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: 8px;
  color: var(--text);
}

.ai-empty :deep(svg) { color: var(--accent); }
.ai-empty-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ai-empty-title { font-size: 12px; font-weight: 600; margin: 0; color: var(--text); }
.ai-empty-desc {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.45;
}
.ai-empty-desc code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  padding: 1px 4px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 3px;
}

.ai-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text);
  cursor: pointer;
  line-height: 1.4;
}

.ai-toggle input { accent-color: var(--accent); cursor: pointer; }

@media (max-width: 520px) {
  .ai-empty {
    grid-template-columns: 1fr;
    text-align: left;
  }
}
</style>
