<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { useAIConfig } from '../composables/useAIConfig'
import { ANTHROPIC_PRICING } from '../services/embeddedAgent/pricing'

const ai = useAIConfig()

const revealed = ref(false)

const inputType = computed(() => (revealed.value ? 'text' : 'password'))

const maskedHint = computed(() => {
  const k = ai.apiKey.value.trim()
  if (!k) return ''
  if (k.length < 12) return '••••'
  return `${k.slice(0, 6)}…${k.slice(-4)}`
})

const validationTone = computed(() => {
  switch (ai.validationState.value) {
    case 'ok': return 'success'
    case 'invalid': return 'danger'
    case 'error': return 'warning'
    case 'validating': return 'info'
    default: return 'muted'
  }
})

async function onSave() {
  await ai.validate()
}

function onCapInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  // Allow free-form typing; the composable parses on read.
  ai.capUsdRaw.value = v
}
</script>

<template>
  <div class="ai-panel">
    <section class="ai-section">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Anthropic API key</h3>
        <p class="ai-section-desc">
          Used by the embedded agent loop. Stored in your browser only — never
          sent to any Annotask server.
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="ai-key">Key</label>
        <div class="ai-input-row">
          <input
            id="ai-key"
            class="ai-input"
            :type="inputType"
            v-model="ai.apiKey.value"
            placeholder="sk-ant-…"
            spellcheck="false"
            autocomplete="off"
            data-testid="ai-key-input"
          />
          <button
            type="button"
            class="ai-icon-btn"
            :title="revealed ? 'Hide key' : 'Reveal key'"
            @click="revealed = !revealed"
          >
            <Icon :name="revealed ? 'x' : 'lock'" :size="13" />
          </button>
        </div>
        <div class="ai-hint">
          <Icon name="lock" :size="11" />
          <span v-if="maskedHint">{{ maskedHint }}</span>
          <span v-else>No key yet — paste one above.</span>
        </div>
      </div>

      <div class="ai-actions">
        <button
          type="button"
          class="ai-btn ai-btn-primary"
          :disabled="!ai.apiKey.value.trim() || ai.validationState.value === 'validating'"
          data-testid="ai-key-validate"
          @click="onSave"
        >
          <Icon v-if="ai.validationState.value === 'validating'" name="refresh-cw" :size="12" />
          <Icon v-else-if="ai.validationState.value === 'ok'" name="check" :size="12" />
          <span v-if="ai.validationState.value === 'validating'">Validating…</span>
          <span v-else-if="ai.validationState.value === 'ok'">Re-validate</span>
          <span v-else>Save &amp; validate</span>
        </button>
        <button
          v-if="ai.hasKey.value"
          type="button"
          class="ai-btn ai-btn-ghost"
          @click="ai.clearKey()"
        >
          Remove key
        </button>
      </div>

      <div
        v-if="ai.validationState.value !== 'idle'"
        class="ai-validation"
        :class="`tone-${validationTone}`"
        data-testid="ai-key-validation"
      >
        <Icon
          :name="
            validationTone === 'success'
              ? 'check'
              : validationTone === 'danger'
              ? 'triangle-alert'
              : validationTone === 'warning'
              ? 'triangle-alert'
              : 'info'
          "
          :size="12"
        />
        <span>{{ ai.validationMessage.value || (ai.validationState.value === 'validating' ? 'Calling /v1/models…' : '') }}</span>
      </div>
    </section>

    <section class="ai-section">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Model</h3>
        <p class="ai-section-desc">Default model for embedded runs. Pricing drives the cost meter.</p>
      </div>
      <div class="ai-model-grid">
        <button
          v-for="id in ai.availableModels"
          :key="id"
          type="button"
          class="ai-model-card"
          :class="{ active: ai.model.value === id }"
          @click="ai.model.value = id"
        >
          <span class="ai-model-name">{{ ANTHROPIC_PRICING[id].label }}</span>
          <span class="ai-model-rate">
            ${{ ANTHROPIC_PRICING[id].inputPerMTok }}/M in ·
            ${{ ANTHROPIC_PRICING[id].outputPerMTok }}/M out
          </span>
        </button>
      </div>
    </section>

    <section class="ai-section">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Per-task cost cap</h3>
        <p class="ai-section-desc">
          The agent loop aborts when this run's running total crosses the cap.
          Use a small cap during experimentation.
        </p>
      </div>
      <div class="ai-field ai-field-inline">
        <label class="ai-label" for="ai-cap">Cap (USD)</label>
        <div class="ai-input-row ai-input-row-narrow">
          <span class="ai-prefix">$</span>
          <input
            id="ai-cap"
            class="ai-input ai-input-narrow"
            type="number"
            min="0.01"
            step="0.05"
            :value="ai.capUsdRaw.value"
            @input="onCapInput"
            data-testid="ai-cap-input"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<!--
  Styles live in src/shell/styles/_ai-settings.css and are shared with
  ProviderSettingsPanel.vue. Adjust there to keep both surfaces in sync.
-->
