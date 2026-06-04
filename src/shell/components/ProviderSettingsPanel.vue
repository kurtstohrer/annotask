<script setup lang="ts">
/**
 * LLM Providers panel — CLI-only.
 *
 * Trimmed-down config surface for the four local-CLI providers Annotask
 * drives (claude, codex, opencode, copilot). Everything HTTP-provider-
 * specific (API keys, endpoint URLs, paperclip, …) is gone — those will
 * come back behind an explicit "API" tab when the tool-write loop is wired
 * for HTTP providers.
 *
 * What lives here:
 *   - Active provider (compact dropdown, top-right, shows detection status)
 *   - Global permission mode (per-provider override per CLI)
 *   - Per-provider permission mode override + extra-args input
 *   - Local-CLI status / billing note (claude-local)
 *   - Guardrails (redaction + event log toggle, clear log)
 *
 * Moved elsewhere:
 *   - Agent mode    → General tab (AgentModePanel.vue)
 *   - Token usage   → Usage tab (UsagePanel.vue)
 *   - Model + Effort → per-persona / per-task (AgentDirectionsPanel.vue,
 *                     TaskDetailModal.vue chip)
 */
import { computed, ref, watch, onMounted } from 'vue'
import Icon from './Icon.vue'
import { useProviderSettings } from '../composables/useProviderSettings'
import { fetchAgentDetect, useAgentDetect } from '../composables/useTaskThread'
import { isActiveProviderReady } from '../../embedded/provider-config'
import type { ProviderConfig, ProviderId } from '../../embedded/provider-config'
import { PERMISSION_MODES, type PermissionMode } from '../../schema'
import { NATIVE_PLAN_PROVIDERS } from '../../embedded/permission-mode'

const store = useProviderSettings()
const settings = store.settings
const active = computed<ProviderId>(() => settings.value.activeProvider)

const CLI_PROVIDER_IDS = ['claude-local', 'codex-local', 'opencode-local', 'copilot-local'] as const satisfies readonly ProviderId[]
type CliProviderId = typeof CLI_PROVIDER_IDS[number]

const providerMeta: Record<CliProviderId, { label: string; short: string; bin: string }> = {
  'claude-local':   { label: 'Claude (local CLI)',   short: 'Claude',   bin: 'claude'   },
  'codex-local':    { label: 'Codex (local CLI)',    short: 'Codex',    bin: 'codex'    },
  'opencode-local': { label: 'opencode (local CLI)', short: 'opencode', bin: 'opencode' },
  'copilot-local':  { label: 'Copilot (local CLI)',  short: 'Copilot',  bin: 'copilot'  },
}

// The provider picker (and its snap-to-CLI watch) lives in SettingsOverlay
// now so the picker is shared between sub-tabs (Providers + Usage). This
// panel just reads `active` from the store and renders its own content.

// Local-CLI detection drives the readiness banner under the panel header
// (the picker badge lives in the parent tab header).
const detect = useAgentDetect()
onMounted(() => { fetchAgentDetect() })

// Mirror the detect snapshot into the provider-settings probe so the rest of
// the app (Conversation tab, agent-mode auto-run gate, …) sees a consistent
// "is this CLI ready" answer.
watch(
  () => detect.snapshot.value,
  (snap) => {
    if (!snap) return
    store.setLocalCliProbe({
      'claude-local':   !!(snap['claude-local'].found   && snap['claude-local'].loggedIn),
      'codex-local':    !!(snap['codex-local'].found    && snap['codex-local'].loggedIn),
      'opencode-local': !!(snap['opencode-local'].found && snap['opencode-local'].loggedIn),
      'copilot-local':  !!(snap['copilot-local']?.found && snap['copilot-local']?.loggedIn),
    })
  },
  { immediate: true },
)

const localReadiness = computed(() => {
  const snap = detect.snapshot.value
  return {
    'claude-local':   !!(snap && snap['claude-local'].found   && snap['claude-local'].loggedIn),
    'codex-local':    !!(snap && snap['codex-local'].found    && snap['codex-local'].loggedIn),
    'opencode-local': !!(snap && snap['opencode-local'].found && snap['opencode-local'].loggedIn),
    'copilot-local':  !!(snap && snap['copilot-local']?.found && snap['copilot-local']?.loggedIn),
  }
})
const activeReady = computed(() => isActiveProviderReady(settings.value, localReadiness.value))

function statusForCli(id: CliProviderId): 'ready' | 'unauth' | 'missing' | 'probing' {
  const snap = detect.snapshot.value
  if (!snap) return 'probing'
  const s = snap[id]
  if (!s || !s.found) return 'missing'
  if (!s.loggedIn) return 'unauth'
  return 'ready'
}

const activeStatus = computed(() => statusForCli(active.value as CliProviderId))
const activeStatusTone = computed<'success' | 'warning' | 'danger' | 'muted'>(() => {
  switch (activeStatus.value) {
    case 'ready':   return 'success'
    case 'unauth':  return 'warning'
    case 'missing': return 'danger'
    case 'probing': return 'muted'
  }
})

// ── Per-provider permission mode + extra args ─────────────────────────────
const providerPermissionMode = computed<string>(() => {
  const cfg = settings.value.providers[active.value]
  return (cfg as { permissionMode?: PermissionMode }).permissionMode ?? ''
})
function setProviderPermissionMode(value: string) {
  if (value === '') {
    store.setProviderPermissionMode(active.value, null)
    return
  }
  if (!(PERMISSION_MODES as readonly string[]).includes(value)) return
  store.setProviderPermissionMode(active.value, value as PermissionMode)
}

const extraArgsText = ref('')
function syncExtraArgsFromStore() {
  const cfg = settings.value.providers[active.value] as { extraArgs?: string[] }
  extraArgsText.value = (cfg.extraArgs ?? []).join(' ')
}
watch(active, syncExtraArgsFromStore, { immediate: true })
watch(() => settings.value.providers[active.value], syncExtraArgsFromStore, { deep: true })

/**
 * Split a CLI-args string into argv, honoring single/double quotes and
 * backslash escapes so `--foo "bar baz"` becomes ['--foo', 'bar baz'] instead
 * of the three broken fragments a naive whitespace split produced. Unbalanced
 * quotes degrade gracefully (the open run becomes one token). Args go straight
 * into spawn argv (shell:false), so there's no shell to re-interpret them.
 */
function tokenizeArgs(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let has = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < input.length) { cur += input[++i]; continue }
      if (ch === quote) { quote = null; continue }
      cur += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue }
    if (ch === '\\' && i + 1 < input.length) { cur += input[++i]; has = true; continue }
    if (/\s/.test(ch)) {
      if (has) { out.push(cur); cur = ''; has = false }
      continue
    }
    cur += ch
    has = true
  }
  if (has) out.push(cur)
  return out.filter(s => s.length > 0)
}

function commitExtraArgs() {
  const current = settings.value.providers[active.value]
  store.setProviderConfig({ ...current, extraArgs: tokenizeArgs(extraArgsText.value) } as ProviderConfig)
}

// ── Global permission mode ────────────────────────────────────────────────

const PERMISSION_MODE_HINTS: Record<PermissionMode, string> = {
  default: 'Auto (recommended) — least-permissive mode that still applies tasks: codex runs in its --full-auto sandbox and copilot at minimal access; claude/opencode have no headless ask-mode, so this runs as bypass for them.',
  plan: 'Read-only. Agent investigates but cannot write. Enforced via CLI/sandbox + model directive.',
  bypass: 'Auto-approve everything, all sandboxes off (incl. shell + writes outside the repo). Fastest, riskiest — opt-in.',
}

const planModeHint = computed(() => {
  if (settings.value.permissionMode !== 'plan') return PERMISSION_MODE_HINTS[settings.value.permissionMode]
  if (NATIVE_PLAN_PROVIDERS.has(active.value)) {
    return 'Read-only. Agent investigates but cannot write. Enforced via CLI/sandbox + model directive.'
  }
  return 'Read-only (best-effort). This provider lacks native plan enforcement — read-only is enforced via model directive only, not CLI/OS sandbox.'
})
function setGlobalPermissionMode(mode: PermissionMode) {
  store.setPermissionMode(mode)
}

// ── Guardrails ────────────────────────────────────────────────────────────
function onClearEventLog() {
  store.eventLog.clear()
}
</script>

<template>
  <div class="ai-panel provider-panel">
    <!-- Readiness banner — picker lives in the parent tab header now. -->
    <div
      class="ai-validation"
      :class="`tone-${activeStatusTone}`"
      data-testid="provider-readiness"
    >
      <Icon :name="activeReady ? 'check' : 'info'" :size="12" />
      <span v-if="activeReady">
        {{ providerMeta[active as CliProviderId].label }} is ready.
      </span>
      <span v-else-if="activeStatus === 'missing'">
        <code>{{ providerMeta[active as CliProviderId].bin }}</code> is not on your PATH.
        Install the CLI to use this provider.
      </span>
      <span v-else-if="activeStatus === 'unauth'">
        Found <code>{{ providerMeta[active as CliProviderId].bin }}</code> but it's not
        logged in. Run <code>{{ providerMeta[active as CliProviderId].bin }} login</code>
        in a terminal.
      </span>
      <span v-else>Probing local CLI…</span>
    </div>

    <!-- Global permission mode. The floor for all providers. Per-provider
         and per-task overrides win. -->
    <section class="ai-section" aria-label="Permission mode">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Permission mode</h3>
        <p class="ai-section-desc">
          Global default for how agents approve actions. The per-provider
          dropdown below can override it for one CLI; the chip menu on each
          task can override that.
        </p>
      </div>
      <div class="agent-mode-strip" role="radiogroup" aria-label="Permission mode">
        <button
          v-for="m in PERMISSION_MODES"
          :key="m"
          type="button"
          role="radio"
          :aria-checked="settings.permissionMode === m"
          :class="['agent-mode-btn', { active: settings.permissionMode === m }]"
          :data-testid="`global-permission-mode-${m}`"
          @click="setGlobalPermissionMode(m)"
        >
          {{ m }}
        </button>
      </div>
      <p class="ai-hint">{{ planModeHint }}</p>
    </section>

    <!-- Per-provider settings — permission override + extra args. -->
    <section class="ai-section" aria-label="Provider settings">
      <div class="ai-section-head">
        <h3 class="ai-section-title">{{ providerMeta[active as CliProviderId].short }} settings</h3>
        <p class="ai-section-desc">
          Overrides specific to this CLI. Model and effort live on each
          persona — adjust them in the Agents tab.
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" :for="`engine-perm-${active}`">Permission mode override</label>
        <select
          :id="`engine-perm-${active}`"
          class="ai-input"
          :value="providerPermissionMode"
          data-testid="engine-permission-mode"
          @change="setProviderPermissionMode(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Inherit global ({{ settings.permissionMode }})</option>
          <option v-for="m in PERMISSION_MODES" :key="m" :value="m">{{ m }}</option>
        </select>
        <p class="ai-hint">
          Useful when one CLI sandboxes natively (codex) and another doesn't
          (claude). Tasks can override this further via the chip menu.
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" :for="`engine-extra-${active}`">Extra CLI args</label>
        <input
          :id="`engine-extra-${active}`"
          type="text"
          class="ai-input"
          :value="extraArgsText"
          :placeholder="`Appended to ${providerMeta[active as CliProviderId].bin} command`"
          data-testid="engine-extra-args"
          @input="extraArgsText = ($event.target as HTMLInputElement).value"
          @change="commitExtraArgs"
          @blur="commitExtraArgs"
        />
        <p class="ai-hint">
          Space-separated; quote values with spaces (e.g. <code>--foo "bar baz"</code>).
          Passed as-is after Annotask's canonical args.
        </p>
      </div>
    </section>

    <!-- Claude Code billing nuance — Pro/Max headless usage draws from the
         Agent SDK credit pool starting 2026-06-15. Surface it here so users
         on a paid Claude plan know what they're picking. -->
    <section
      v-if="active === 'claude-local'"
      class="ai-section"
      aria-label="Claude billing"
    >
      <div class="ai-validation tone-info" data-testid="claude-local-billing-note">
        <Icon name="info" :size="12" />
        <span>
          On Pro/Max plans, Annotask's calls run via Claude Code's headless
          mode and (from 2026-06-15) draw from your
          <strong>Agent SDK credit pool</strong> — separate from your
          interactive session limit.
          <a
            href="https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan"
            target="_blank"
            rel="noopener"
          >Details</a>.
        </span>
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

    <section class="ai-section" aria-label="Run safety">
      <div class="ai-section-head">
        <h3 class="ai-section-title">Run safety</h3>
        <p class="ai-section-desc">
          Stop a stuck agent from running forever. Set either to 0 to disable.
        </p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="idle-timeout">Idle timeout (seconds)</label>
        <input
          id="idle-timeout"
          type="number"
          min="0"
          step="10"
          class="ai-input"
          data-testid="idle-timeout"
          :value="Math.round(settings.idleTimeoutMs / 1000)"
          @change="store.setIdleTimeoutMs(Number(($event.target as HTMLInputElement).value) * 1000)"
        />
        <p class="ai-hint">Cancel a run that produces no output for this long.</p>
      </div>

      <div class="ai-field">
        <label class="ai-label" for="max-duration">Max run duration (minutes)</label>
        <input
          id="max-duration"
          type="number"
          min="0"
          step="1"
          class="ai-input"
          data-testid="max-run-duration"
          :value="Math.round(settings.maxRunDurationMs / 60000)"
          @change="store.setMaxRunDurationMs(Number(($event.target as HTMLInputElement).value) * 60000)"
        />
        <p class="ai-hint">Absolute ceiling per run, regardless of activity.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ai-panel.provider-panel {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

/* ── Readiness banner ── */
.ai-validation {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 12px;
  line-height: 1.45;
  color: var(--text);
}
.ai-validation code {
  font-size: 11px;
  padding: 1px 5px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-variant-numeric: tabular-nums;
}
.ai-validation.tone-success { color: var(--success); border-color: color-mix(in srgb, var(--success) 40%, var(--border)); }
.ai-validation.tone-warning { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 40%, var(--border)); }
.ai-validation.tone-danger  { color: var(--danger);  border-color: color-mix(in srgb, var(--danger)  40%, var(--border)); }
.ai-validation.tone-info    { color: var(--info);    border-color: color-mix(in srgb, var(--info)    40%, var(--border)); }
.ai-validation.tone-muted   { color: var(--text-muted); }

/* ── Sections ── */
.ai-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ai-section-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ai-section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.ai-section-desc {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.5;
}
.ai-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.45;
}

/* ── Permission mode strip ── */
.agent-mode-strip {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 7px;
  align-self: flex-start;
}
.agent-mode-btn {
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 16px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 5px;
  cursor: pointer;
  text-transform: lowercase;
}
.agent-mode-btn:hover:not(.active):not(:disabled) { color: var(--text); }
.agent-mode-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.agent-mode-btn.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 3px var(--shadow);
}

/* ── Per-provider fields ── */
.ai-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ai-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.ai-input {
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text);
}
.ai-input:focus { outline: none; border-color: var(--accent); }
.ai-input:hover:not(:focus) { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }

/* ── Toggles + actions ── */
.ai-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text);
  cursor: pointer;
}
.ai-actions {
  display: flex;
  gap: 8px;
}
.ai-btn {
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 5px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
}
.ai-btn:hover { border-color: var(--text-muted); }
.ai-btn-ghost { background: transparent; }
</style>
