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
import { computed, reactive, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
import { useProviderSettings } from '../composables/useProviderSettings'
import { fetchAgentDetect, useAgentDetect } from '../composables/useTaskThread'
import { useAgentModels } from '../composables/useAgentModels'
import { isActiveProviderReady, validateProviderConfig, AGENT_MODES, EFFORTS_BY_PROVIDER, EFFORT_LEVELS } from '../../embedded/provider-config'
import type { AgentMode, EffortLevel, ProviderConfig, ProviderId } from '../../embedded/provider-config'

const store = useProviderSettings()

const settings = store.settings
const active = computed<ProviderId>(() => settings.value.activeProvider)

const providerMeta: Record<
  ProviderId,
  { label: string; short: string; tagline: string }
> = {
  'claude-local': {
    label: 'Claude (local CLI)',
    short: 'Claude',
    tagline: 'Reuses your `claude` login — no API key needed',
  },
  'codex-local': {
    label: 'Codex (local CLI)',
    short: 'Codex',
    tagline: 'Reuses your `codex` login — no API key needed',
  },
  'opencode-local': {
    label: 'opencode (local CLI)',
    short: 'opencode',
    tagline: 'Reuses your `opencode` login — no API key needed',
  },
  'copilot-local': {
    label: 'Copilot (local CLI)',
    short: 'Copilot CLI',
    tagline: 'Reuses your `copilot login` — no API key needed',
  },
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
  openrouter: {
    label: 'OpenRouter',
    short: 'OpenRouter',
    tagline: 'One key, every model — BYOK',
  },
  'openai-compatible': {
    label: 'OpenAI-compatible',
    short: 'Compatible',
    tagline: 'Ollama · LM Studio · vLLM · self-hosted',
  },
  paperclip: {
    label: 'Paperclip',
    short: 'Paperclip',
    tagline: 'Managed inference for your company',
  },
}

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

const paperclipConnected = computed(() => {
  const p = settings.value.providers.paperclip
  return p.apiKey.trim().length > 0 && p.companyId.trim().length > 0
})

function readinessTone(ready: boolean): 'success' | 'muted' {
  return ready ? 'success' : 'muted'
}

// Dynamic model list — sourced from the singleton useAgentModels cache.
// Every place that picks a model in annotask reads from the same composable
// so the catalog stays consistent across Settings, the InitWizard, and the
// per-persona AgentDirectionsPanel. Fetched live from /api/agent/models.
// There is intentionally no curated fallback: if the probe fails the catalog
// comes back as Auto-only with an `error` field, and the picker below is
// blocked so the user can't silently pick a model the CLI will reject.
const agentModels = useAgentModels()
const modelOptions = computed(() => agentModels.catalogFor(active.value).value.models)
const modelsLoading = computed(() => agentModels.state.loading[active.value] === true)
const modelsError = computed(() => agentModels.state.errors[active.value])
const modelCatalog = computed(() => agentModels.catalogFor(active.value).value)
// True when discovery returned nothing — the dropdown is reduced to Auto.
// We still let the user keep / preserve a model id they previously saved
// (the "(custom)" option below), but the picker is otherwise blocked and a
// warning explains why.
const modelsBlocked = computed(
  () => !modelsLoading.value && modelOptions.value.length <= 1 && !modelCatalog.value.discovered,
)
const savedCustomModel = computed(() => {
  const id = settings.value.providers[active.value].model
  return id && !modelOptions.value.some((m) => m.id === id) ? id : ''
})
// Stale-model state: discovery DID return a real catalog, but the user's
// saved model id isn't in it. This is the failure mode the removed curated
// fallback used to mask — users picked an id like `gpt-5.4-mini` that
// their account doesn't actually carry, and the provider rejects it at
// chat time with "model may not exist or you may not have access". We
// surface it inline so the user can reset to Auto without hunting for the
// config file.
const staleSavedModel = computed(() => {
  if (modelsLoading.value) return ''
  if (!modelCatalog.value.discovered) return ''
  const saved = settings.value.providers[active.value].model
  if (!saved) return ''
  return modelOptions.value.some((m) => m.id === saved) ? '' : saved
})

// Effort options filtered to what the active provider actually supports.
const effortOptionsForActive = computed<readonly EffortLevel[]>(() =>
  EFFORTS_BY_PROVIDER[active.value] ?? EFFORT_LEVELS,
)

// Trigger a fetch on mount and whenever the active provider changes. The
// composable dedupes concurrent calls so this is safe to fire eagerly.
// After the catalog resolves we auto-clear any saved model id that isn't in
// the freshly-discovered list — otherwise switching providers leaves a stale
// pick that chat will reject at runtime with "model may not exist". The
// manual "Reset to Auto" button still exists as a fallback for edge cases
// where discovery hasn't run yet.
watch(active, async (id) => {
  const catalog = await agentModels.ensure(id)
  if (!catalog.discovered) return
  const saved = settings.value.providers[id].model
  if (!saved) return
  if (catalog.models.some((m) => m.id === saved)) return
  store.setModel(id, '')
}, { immediate: true })

// When the picker enters the "Cannot fetch models" state and the user has a
// stale model id saved, default that input back to Auto (empty) so the
// blocked-state UI starts clean instead of pre-filling a value the live
// probe couldn't confirm.
watch(modelsBlocked, (blocked) => {
  if (!blocked) return
  if (!settings.value.providers[active.value].model) return
  store.setModel(active.value, '')
})

async function refreshModels() {
  await agentModels.refresh(active.value)
}

function setModel(id: ProviderId, model: string) {
  store.setModel(id, model)
}

function setEffort(id: ProviderId, effort: EffortLevel) {
  store.setEffort(id, effort)
}

function setAgentMode(mode: AgentMode) {
  store.setAgentMode(mode)
}

const AGENT_MODE_DESCRIPTIONS: Record<AgentMode, string> = {
  auto: 'Tasks auto-run on create. The agent opens the Conversation tab and starts immediately.',
  manual: 'Conversation tab is available, but the agent only runs when you click Run-with-agent on a task.',
  off: 'No in-shell chat surface. Drive agents from the terminal via MCP, the annotask CLI, or the /annotask-apply skill.',
}

// Local-CLI detection — drives the auto-detect banner and the readiness
// of the local-CLI provider branches (claude-local, codex-local, opencode-local).
const detect = useAgentDetect()
onMounted(() => { fetchAgentDetect() })

// Mirror the detect snapshot into the provider-settings probe so the
// `store.ready` computed reflects reality everywhere (Conversation tab,
// agent-mode auto-run gate, …) without each consumer re-querying detect.
watch(
  () => detect.snapshot.value,
  (snap) => {
    if (!snap) return
    store.setLocalCliProbe({
      'claude-local': !!(snap['claude-local'].found && snap['claude-local'].loggedIn),
      'codex-local': !!(snap['codex-local'].found && snap['codex-local'].loggedIn),
      'opencode-local': !!(snap['opencode-local'].found && snap['opencode-local'].loggedIn),
      'copilot-local': !!(snap['copilot-local']?.found && snap['copilot-local']?.loggedIn),
    })
  },
  { immediate: true },
)

const localReadiness = computed(() => {
  const snap = detect.snapshot.value
  return {
    'claude-local': !!(snap && snap['claude-local'].found && snap['claude-local'].loggedIn),
    'codex-local': !!(snap && snap['codex-local'].found && snap['codex-local'].loggedIn),
    'opencode-local': !!(snap && snap['opencode-local'].found && snap['opencode-local'].loggedIn),
    'copilot-local': !!(snap && snap['copilot-local']?.found && snap['copilot-local']?.loggedIn),
  }
})

// Override the M4 `store.ready` so local-CLI providers respect the probe
// even before the watcher has fired (or for tests that bypass the panel).
const activeReady = computed(() => isActiveProviderReady(settings.value, localReadiness.value))

const isLocalCli = computed(() =>
  active.value === 'claude-local' || active.value === 'codex-local' ||
  active.value === 'opencode-local' || active.value === 'copilot-local',
)

// ── Token usage summary (project-wide ledger) ────────────────────────────────
// Reads `.annotask/usage.jsonl` via /api/usage. Reload every time the panel is
// mounted plus on a slow timer while open so users see new turns without
// reopening Settings. We deliberately don't wire to the WS broadcast: usage
// updates are high-frequency but low-priority, polling is cheap.

interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  turns: number
}
interface UsageSummary {
  totals: UsageTotals
  byScope: Record<'task' | 'init' | 'apply' | 'chat', UsageTotals>
  byProvider: Record<string, UsageTotals>
  firstAt: number | null
  lastAt: number | null
}

const usageSummary = ref<UsageSummary | null>(null)
let usagePollTimer: number | null = null

async function refreshUsage() {
  try {
    const res = await fetch('/__annotask/api/usage')
    if (!res.ok) return
    usageSummary.value = await res.json()
  } catch { /* offline — keep previous */ }
}

onMounted(() => {
  void refreshUsage()
  usagePollTimer = window.setInterval(refreshUsage, 15_000)
})
onBeforeUnmount(() => {
  if (usagePollTimer !== null) { window.clearInterval(usagePollTimer); usagePollTimer = null }
})

function formatTokens(n: number): string {
  if (n < 1000) return n.toString()
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`
}

function formatRelative(ts: number | null): string {
  if (!ts) return '—'
  const ms = Date.now() - ts
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}

const usageByProvider = computed<Array<{ id: string; totals: UsageTotals }>>(() => {
  const map = usageSummary.value?.byProvider ?? {}
  return Object.entries(map)
    .map(([id, totals]) => ({ id, totals }))
    .sort((a, b) => (b.totals.inputTokens + b.totals.outputTokens) - (a.totals.inputTokens + a.totals.outputTokens))
})

const usageByScope = computed<Array<{ scope: 'task' | 'init' | 'apply' | 'chat'; totals: UsageTotals }>>(() => {
  const map = usageSummary.value?.byScope
  if (!map) return []
  const order: Array<'task' | 'init' | 'apply' | 'chat'> = ['task', 'init', 'apply', 'chat']
  return order
    .map(scope => ({ scope, totals: map[scope] }))
    .filter(row => row.totals && row.totals.turns > 0)
})

const SCOPE_LABELS: Record<'task' | 'init' | 'apply' | 'chat', string> = {
  task: 'Task conversations',
  init: 'Initialization',
  apply: 'Apply runs',
  chat: 'Other chat',
}

function localCliStatusLabel(id: 'claude-local' | 'codex-local' | 'opencode-local' | 'copilot-local'): string {
  const snap = detect.snapshot.value
  if (!snap) return 'Probing…'
  const s = snap[id]
  if (!s.found) return 'Not installed on PATH'
  if (!s.loggedIn) return `Found${s.version ? ` (${s.version})` : ''} — not logged in`
  return `Logged in${s.version ? ` · ${s.version}` : ''}`
}

function localCliTone(id: 'claude-local' | 'codex-local' | 'opencode-local' | 'copilot-local'): 'success' | 'warning' | 'muted' {
  const snap = detect.snapshot.value
  if (!snap) return 'muted'
  const s = snap[id]
  if (!s.found) return 'muted'
  if (!s.loggedIn) return 'warning'
  return 'success'
}
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
        <span v-else-if="isLocalCli">Local CLI not detected — see status below.</span>
        <span v-else>Add credentials below to start using {{ providerMeta[active].label }}.</span>
      </div>
    </section>

    <!-- Engine — Model + Effort dropdowns for the active provider. Both
         default to "auto" so the provider picks. Pre-populated curated
         suggestions live in <datalist>; users can also type any value. -->
    <section class="ai-section" aria-label="Engine settings">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Engine</h3>
        <p class="ai-section-desc">
          Pick the model and reasoning effort. <code>Auto</code> lets the
          provider pick — recommended unless you have a specific target.
        </p>
      </div>

      <div class="ai-engine-grid">
        <div class="ai-field">
          <label class="ai-label" :for="`engine-model-${active}`">Model</label>
          <div class="engine-model-row">
            <select
              :id="`engine-model-${active}`"
              class="ai-input engine-model-select"
              :value="settings.providers[active].model"
              :disabled="modelsLoading"
              data-testid="engine-model"
              @change="setModel(active, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="m in modelOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
              <!-- Preserve a custom id the user previously typed/saved that
                   isn't in the discovered or curated list. -->
              <option
                v-if="settings.providers[active].model && !modelOptions.some(m => m.id === settings.providers[active].model)"
                :value="settings.providers[active].model"
              >
                {{ settings.providers[active].model }} (custom)
              </option>
            </select>
            <button
              type="button"
              class="ai-icon-btn engine-model-refresh"
              :disabled="modelsLoading"
              :title="modelsLoading ? 'Refreshing…' : 'Refresh models'"
              data-testid="engine-model-refresh"
              @click="refreshModels"
            >
              <Icon name="refresh-cw" :size="12" />
            </button>
          </div>
          <p class="ai-hint">
            <span v-if="modelsLoading">Loading…</span>
            <span v-else-if="modelCatalog.discovered">
              Discovered live from {{ active }}.
            </span>
          </p>

          <!-- Blocked state: the live probe didn't return any models. We
               surface the server-provided error verbatim and let the user
               keep their previously-saved model id (preserved as the
               "(custom)" option above), or type a new one explicitly so we
               never invent a model they don't actually have. -->
          <div
            v-if="modelsBlocked"
            class="ai-warning"
            role="alert"
            data-testid="engine-model-blocked"
          >
            <Icon name="triangle-alert" :size="14" />
            <div class="ai-warning-body">
              <strong>Cannot fetch models</strong>
              <p>{{ modelCatalog.error || modelsError || 'The live probe returned nothing. Sign in to the provider and try Refresh.' }}</p>
              <label class="ai-warning-input-row">
                <span>Set a custom model id (optional — uses Auto otherwise)</span>
                <input
                  type="text"
                  class="ai-input"
                  :value="savedCustomModel"
                  placeholder="Auto (CLI default)"
                  data-testid="engine-model-custom"
                  @change="setModel(active, ($event.target as HTMLInputElement).value.trim())"
                />
              </label>
            </div>
          </div>

          <!-- Stale-saved-model state: the probe returned a real catalog, but
               the user's saved id isn't in it — almost always a leftover from
               the removed curated fallback. Picking it would fail at chat time
               with "model may not exist or you may not have access". Offer a
               one-click reset to Auto. -->
          <div
            v-if="staleSavedModel"
            class="ai-warning"
            role="alert"
            data-testid="engine-model-stale"
          >
            <Icon name="triangle-alert" :size="14" />
            <div class="ai-warning-body">
              <strong>Saved model <code>{{ staleSavedModel }}</code> isn't in your discovered list.</strong>
              <p>
                Your account doesn't appear to have access to this model on
                {{ active }} — calls will fail with "model may not exist or you
                may not have access". Reset to Auto, or pick one of the
                discovered models above.
              </p>
              <button
                type="button"
                class="ai-warning-btn"
                data-testid="engine-model-stale-reset"
                @click="setModel(active, '')"
              >
                Reset to Auto
              </button>
            </div>
          </div>
        </div>

        <div class="ai-field">
          <label class="ai-label" :for="`engine-effort-${active}`">Reasoning effort</label>
          <select
            :id="`engine-effort-${active}`"
            class="ai-input"
            :value="settings.providers[active].effort"
            data-testid="engine-effort"
            @change="setEffort(active, ($event.target as HTMLSelectElement).value as EffortLevel)"
          >
            <option v-for="lvl in effortOptionsForActive" :key="lvl" :value="lvl">{{ lvl }}</option>
          </select>
          <p class="ai-hint">
            Higher = more reasoning before reply. Providers that don't
            support it ignore the hint.
          </p>
        </div>
      </div>
    </section>

    <!-- Agent mode — tri-state. `auto` is hands-free; `manual` is the
         default (chat available, user launches per task); `off` hides the
         in-shell chat entirely and routes users to the terminal/MCP. -->
    <section class="ai-section" aria-label="Agent mode">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Agent mode</h3>
        <p class="ai-section-desc">
          Controls how aggressive the in-shell agent is.
        </p>
      </div>
      <div class="agent-mode-strip" role="radiogroup" aria-label="Agent mode">
        <button
          v-for="mode in AGENT_MODES"
          :key="mode"
          type="button"
          role="radio"
          :aria-checked="settings.agentMode === mode"
          :class="['agent-mode-btn', { active: settings.agentMode === mode }]"
          :data-testid="`agent-mode-${mode}`"
          :disabled="mode !== 'off' && !activeReady"
          @click="setAgentMode(mode)"
        >
          {{ mode }}
        </button>
      </div>
      <p class="ai-hint">{{ AGENT_MODE_DESCRIPTIONS[settings.agentMode] }}</p>
      <p v-if="!activeReady && settings.agentMode !== 'off'" class="ai-hint tone-warning">
        Configure a provider above to use auto or manual mode.
      </p>
    </section>

    <!-- Local-CLI detection banner. Surfaces "claude is logged in — use it"
         so users with a CLI already installed never have to paste an API key. -->
    <section v-if="detect.snapshot.value" class="ai-section" aria-label="Detected local CLIs">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Detected on this machine</h3>
        <p class="ai-section-desc">
          Local CLIs you're already logged into. Click "Use" to switch the
          embedded chat to that provider — no API key needed.
        </p>
      </div>
      <div class="detect-grid">
        <div
          v-for="id in (['claude-local', 'codex-local', 'opencode-local', 'copilot-local'] as const)"
          :key="id"
          class="detect-card"
          :class="`tone-${localCliTone(id)}`"
        >
          <div class="detect-card-head">
            <span class="detect-card-name">{{ providerMeta[id].short }}</span>
            <span class="detect-card-status">{{ localCliStatusLabel(id) }}</span>
          </div>
          <button
            type="button"
            class="detect-card-cta"
            :disabled="!localReadiness[id] || active === id"
            @click="setProvider(id)"
          >
            {{ active === id ? 'In use' : 'Use' }}
          </button>
        </div>
      </div>
      <button type="button" class="ai-btn ai-btn-ghost detect-refresh" @click="detect.refresh()">
        <Icon name="refresh-cw" :size="11" />
        <span>Refresh</span>
      </button>
    </section>

    <!-- Local-CLI providers carry no credentials in the settings blob —
         everything's in ~/.<cli>/. The Detected banner above already covers
         install + login status, and the Engine section handles model. -->
    <section v-if="isLocalCli" class="ai-section" aria-label="Local CLI">
      <div class="ai-section-head">
        <h3 class="ai-section-title">{{ providerMeta[active].label }}</h3>
        <p class="ai-section-desc">
          Annotask spawns the <code>{{ active === 'claude-local' ? 'claude' : active === 'codex-local' ? 'codex' : active === 'copilot-local' ? 'copilot' : 'opencode' }}</code>
          CLI on demand and reuses your existing login. No credential is
          stored in the browser.
        </p>
      </div>

      <!-- Billing nuance specific to Claude Code. Starting 2026-06-15,
           headless `claude -p` usage on Pro/Max plans is metered against a
           separate Agent SDK credit pool — not the interactive session limit.
           Users on a paid Claude plan should know that picking this provider
           draws from that pool, not their chat session quota. -->
      <div
        v-if="active === 'claude-local'"
        class="ai-validation tone-info"
        data-testid="claude-local-billing-note"
      >
        <Icon name="info" :size="12" />
        <span>
          On Pro/Max plans, Annotask's calls run via Claude Code's headless mode
          and (from 2026-06-15) draw from your <strong>Agent SDK credit pool</strong> —
          separate from your interactive session limit. API-key users on the
          Anthropic tab are billed directly and unaffected.
          <a
            href="https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan"
            target="_blank"
            rel="noopener"
          >Details</a>.
        </span>
      </div>
    </section>

    <!-- OpenRouter — BYOK, OpenAI-compat router -->
    <section v-if="active === 'openrouter'" class="ai-section" aria-label="OpenRouter settings">
      <div class="ai-section-head">
        <h3 class="ai-section-title">OpenRouter key</h3>
        <p class="ai-section-desc">
          One key, every model. Get one at
          <code>https://openrouter.ai/keys</code>.
        </p>
      </div>
      <div class="ai-field">
        <label class="ai-label" for="prov-openrouter-key">API key</label>
        <div class="ai-input-row" :class="{ 'tone-danger': fieldError('apiKey') }">
          <input
            id="prov-openrouter-key"
            class="ai-input"
            :type="inputType('openrouter-key')"
            :value="settings.providers.openrouter.apiKey"
            placeholder="sk-or-…"
            spellcheck="false"
            autocomplete="off"
            data-testid="openrouter-key"
            @input="patchProvider({ id: 'openrouter', apiKey: ($event.target as HTMLInputElement).value })"
          />
          <button
            type="button"
            class="ai-icon-btn"
            :title="revealed['openrouter-key'] ? 'Hide key' : 'Reveal key'"
            @click="toggleReveal('openrouter-key')"
          >
            <Icon :name="revealed['openrouter-key'] ? 'x' : 'lock'" :size="13" />
          </button>
        </div>
        <p v-if="fieldError('apiKey')" class="ai-field-error" role="alert">
          <Icon name="triangle-alert" :size="11" />
          <span>{{ fieldError('apiKey') }}</span>
        </p>
      </div>
      <div class="ai-field">
        <label class="ai-label" for="prov-openrouter-base">Base URL (optional)</label>
        <input
          id="prov-openrouter-base"
          class="ai-input"
          type="text"
          :value="settings.providers.openrouter.baseUrl"
          placeholder="https://openrouter.ai/api/v1"
          spellcheck="false"
          @input="patchProvider({ id: 'openrouter', baseUrl: ($event.target as HTMLInputElement).value })"
        />
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

    <!-- Paperclip — connected / not-connected empty state. -->
    <section v-if="active === 'paperclip'" class="ai-section" aria-label="Paperclip settings">
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

    <!-- Token usage — cumulative across init / task / apply runs.
         Complements the per-conversation budget cap above; this is the
         "since you started using Annotask in this project" view. -->
    <section class="ai-section" aria-label="Token usage">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Token usage</h3>
        <p class="ai-section-desc">
          Cumulative tokens consumed by Annotask in this project — across
          initialization, task conversations, and apply runs. Read from
          <code>.annotask/usage.jsonl</code>.
        </p>
      </div>

      <div v-if="!usageSummary || usageSummary.totals.turns === 0" class="usage-empty">
        No usage recorded yet. Start a conversation on a task or run init.
      </div>

      <div v-else class="usage-grid" data-testid="usage-summary">
        <div class="usage-card">
          <div class="usage-card-label">Input</div>
          <div class="usage-card-value">{{ formatTokens(usageSummary.totals.inputTokens) }}</div>
        </div>
        <div class="usage-card">
          <div class="usage-card-label">Output</div>
          <div class="usage-card-value">{{ formatTokens(usageSummary.totals.outputTokens) }}</div>
        </div>
        <div class="usage-card">
          <div class="usage-card-label">Cache read</div>
          <div class="usage-card-value">{{ formatTokens(usageSummary.totals.cacheReadTokens) }}</div>
        </div>
        <div class="usage-card">
          <div class="usage-card-label">Cache write</div>
          <div class="usage-card-value">{{ formatTokens(usageSummary.totals.cacheCreationTokens) }}</div>
        </div>
        <div class="usage-card">
          <div class="usage-card-label">Turns</div>
          <div class="usage-card-value">{{ usageSummary.totals.turns.toLocaleString() }}</div>
        </div>
        <div class="usage-card">
          <div class="usage-card-label">Last activity</div>
          <div class="usage-card-value usage-card-value-small">{{ formatRelative(usageSummary.lastAt) }}</div>
        </div>
      </div>

      <div v-if="usageByScope.length > 0" class="usage-breakdown">
        <div class="usage-breakdown-title">By scope</div>
        <div
          v-for="row in usageByScope"
          :key="row.scope"
          class="usage-row"
        >
          <span class="usage-row-label">{{ SCOPE_LABELS[row.scope] }}</span>
          <span class="usage-row-value">
            <span class="usage-row-tok">↑ {{ formatTokens(row.totals.inputTokens) }}</span>
            <span class="usage-row-tok">↓ {{ formatTokens(row.totals.outputTokens) }}</span>
            <span class="usage-row-turns">{{ row.totals.turns }}t</span>
          </span>
        </div>
      </div>

      <div v-if="usageByProvider.length > 0" class="usage-breakdown">
        <div class="usage-breakdown-title">By provider</div>
        <div
          v-for="row in usageByProvider"
          :key="row.id"
          class="usage-row"
        >
          <span class="usage-row-label">{{ row.id }}</span>
          <span class="usage-row-value">
            <span class="usage-row-tok">↑ {{ formatTokens(row.totals.inputTokens) }}</span>
            <span class="usage-row-tok">↓ {{ formatTokens(row.totals.outputTokens) }}</span>
            <span class="usage-row-turns">{{ row.totals.turns }}t</span>
          </span>
        </div>
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

.detect-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.detect-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
}
.detect-card.tone-success { border-color: color-mix(in srgb, var(--success) 50%, var(--border)); }
.detect-card.tone-warning { border-color: color-mix(in srgb, var(--warning) 50%, var(--border)); }

.detect-card-head {
  display: flex; flex-direction: column; gap: 2px;
}
.detect-card-name { font-size: 12px; font-weight: 700; color: var(--text); }
.detect-card-status { font-size: 11px; color: var(--text-muted); }

.detect-card-cta {
  align-self: flex-start;
  font-size: 11px; font-weight: 600;
  padding: 4px 10px; border-radius: 4px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--text-on-accent);
  cursor: pointer;
}
.detect-card-cta:hover:not(:disabled) { background: var(--accent-hover); }
.detect-card-cta:disabled { opacity: 0.5; cursor: not-allowed; }

.detect-refresh {
  align-self: flex-start;
  margin-top: 4px;
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
.ai-toggle input:disabled { cursor: not-allowed; opacity: 0.5; }

.ai-engine-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 520px) { .ai-engine-grid { grid-template-columns: 1fr; } }

.engine-model-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
}
.engine-model-select { flex: 1; min-width: 0; }
.engine-model-refresh {
  align-self: stretch;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-muted);
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}
.engine-model-refresh:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-muted);
}
.engine-model-refresh:disabled { opacity: 0.5; cursor: progress; }

.agent-mode-strip {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.agent-mode-btn {
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  text-transform: capitalize;
  padding: 6px 16px;
  background: var(--surface-2);
  color: var(--text);
  border: none;
  cursor: pointer;
  border-right: 1px solid var(--border);
}
.agent-mode-btn:last-child { border-right: none; }
.agent-mode-btn:hover:not(:disabled) { background: var(--surface-3); }
.agent-mode-btn.active {
  background: var(--accent);
  color: var(--text-on-accent);
}
.agent-mode-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ai-hint.tone-warning { color: var(--warning); }

.ai-warning {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--warning) 12%, var(--surface-2));
  border: 1px solid color-mix(in srgb, var(--warning) 45%, var(--border));
  color: var(--text);
  font-size: 12.5px;
  line-height: 1.45;
}
.ai-warning > :first-child { color: var(--warning); flex: 0 0 auto; margin-top: 1px; }
.ai-warning-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; }
.ai-warning-body strong { color: var(--text); }
.ai-warning-body p { margin: 0; color: var(--text-muted); }
.ai-warning-input-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-muted);
}
.ai-warning-input-row .ai-input { font-size: 13px; }
.ai-warning-btn {
  align-self: flex-start;
  margin-top: 4px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--warning) 60%, var(--border));
  background: color-mix(in srgb, var(--warning) 18%, var(--surface));
  color: var(--text);
  cursor: pointer;
}
.ai-warning-btn:hover { background: color-mix(in srgb, var(--warning) 28%, var(--surface)); }
.ai-warning-body code {
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--warning) 18%, var(--surface));
}

@media (max-width: 520px) {
  .ai-empty {
    grid-template-columns: 1fr;
    text-align: left;
  }
}

.usage-empty {
  font-size: 12px; color: var(--text-muted);
  padding: 12px; background: var(--surface-2); border-radius: 6px;
}
.usage-grid {
  display: grid; gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
}
.usage-card {
  padding: 10px 12px; border-radius: 6px;
  background: var(--surface-2); border: 1px solid var(--border);
}
.usage-card-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.usage-card-value { font-size: 18px; font-weight: 600; color: var(--text); margin-top: 2px; font-family: monospace; }
.usage-card-value-small { font-size: 13px; font-weight: 500; }

.usage-breakdown { margin-top: 12px; }
.usage-breakdown-title {
  font-size: 11px; color: var(--text-muted); text-transform: uppercase;
  letter-spacing: 0.04em; margin-bottom: 4px;
}
.usage-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 8px; border-radius: 4px; font-size: 12px;
}
.usage-row:nth-child(even) { background: color-mix(in srgb, var(--surface-2) 50%, transparent); }
.usage-row-label { color: var(--text); }
.usage-row-value { display: flex; gap: 8px; align-items: center; font-family: monospace; }
.usage-row-tok { color: var(--text); }
.usage-row-turns { color: var(--text-muted); font-size: 11px; }
</style>
