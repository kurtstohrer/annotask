<template>
  <div class="fullscreen-overlay settings-overlay">
    <FullscreenOverlayHeader title="Settings" @close="$emit('close')" />
    <div class="settings-layout">
      <nav class="settings-sidebar" aria-label="Settings sections">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          class="settings-nav-btn"
          :class="{ active: activeTab === t.id }"
          :aria-current="activeTab === t.id ? 'page' : undefined"
          :data-testid="`settings-tab-${t.id}`"
          @click="activeTab = t.id"
        >
          <Icon :name="t.icon" :size="14" />
          <span>{{ t.label }}</span>
        </button>
      </nav>

      <div class="settings-content">
        <!-- Agents tab — task-type-routed personas (provider/model/effort overrides). -->
        <section v-if="activeTab === 'agents'" class="settings-page settings-page--wide" aria-label="Agent personas">
          <h2 class="settings-page-title">Agents</h2>
          <AgentsPanel />
        </section>

        <!-- LLM Providers tab — provider config + usage metrics as sub-views.
             The provider picker is lifted here so both sub-tabs share it:
             Usage filters its metrics to the selected provider. -->
        <section v-else-if="activeTab === 'providers'" class="settings-page settings-page--wide" aria-label="LLM providers">
          <div class="settings-page-header">
            <div class="settings-page-header-text">
              <h2 class="settings-page-title">LLM Providers</h2>
              <p class="settings-page-lead">
                Configure the CLIs Annotask can call and track cumulative
                token usage. Per-persona overrides live in the Agents tab.
              </p>
            </div>
            <label class="provider-picker">
              <span class="provider-picker-label">Provider</span>
              <select
                class="provider-picker-select"
                :value="providerSettings.activeProvider.value"
                data-testid="provider-select"
                @change="providerSettings.setActiveProvider(($event.target as HTMLSelectElement).value as ProviderId)"
              >
                <option
                  v-for="id in CLI_PROVIDER_IDS"
                  :key="id"
                  :value="id"
                >
                  {{ providerMeta[id].short }} · {{ STATUS_LABEL[statusForCli(id)] }}
                </option>
              </select>
            </label>
          </div>

          <nav class="settings-subtabs" role="tablist" aria-label="LLM Providers sub-views">
            <button
              type="button"
              role="tab"
              :aria-selected="providersSubTab === 'config'"
              :class="['settings-subtab', { active: providersSubTab === 'config' }]"
              data-testid="providers-subtab-config"
              @click="providersSubTab = 'config'"
            >
              Configuration
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="providersSubTab === 'usage'"
              :class="['settings-subtab', { active: providersSubTab === 'usage' }]"
              data-testid="providers-subtab-usage"
              @click="providersSubTab = 'usage'"
            >
              Usage
            </button>
          </nav>

          <ProviderSettingsPanel v-if="providersSubTab === 'config'" />
          <UsagePanel v-else :provider-id="providerSettings.activeProvider.value" />
        </section>

        <!-- General tab — agent mode + project setup. -->
        <section v-else-if="activeTab === 'general'" class="settings-page" aria-label="General settings">
          <h2 class="settings-page-title">General</h2>
          <p class="settings-page-lead">
            Agent behavior, project setup, and the design-spec status. LLM
            provider configuration lives in LLM Providers; token usage lives
            in Usage.
          </p>

          <!-- Top-level embedded-agent toggle. When off, the user is in
               skill/MCP mode — Conversation tab, auto-run, and the per-task
               agent UI are all hidden. The MCP server keeps running so the
               user's own editor agent can still call /annotask-apply. -->
          <div class="settings-section">
            <label class="settings-label">Embedded agent</label>
            <p class="settings-desc">
              Run a local CLI agent (claude · codex · opencode · copilot) inside
              Annotask. When off, you stay in skill/MCP mode and drive apply
              from your own editor agent.
            </p>
            <div class="embedded-toggle-row">
              <label class="embedded-toggle">
                <input
                  type="checkbox"
                  :checked="embeddedAgentOn"
                  @change="onEmbeddedAgentToggle(($event.target as HTMLInputElement).checked)"
                />
                <span class="embedded-toggle-track" aria-hidden="true">
                  <span class="embedded-toggle-thumb" />
                </span>
                <span class="embedded-toggle-text">
                  {{ embeddedAgentOn ? 'Embedded agent on' : 'Skill / MCP mode' }}
                </span>
              </label>
              <span class="embedded-toggle-badge">Experimental</span>
            </div>

            <div v-if="!embeddedAgentOn" class="skill-mode-banner">
              <strong>You're in skill / MCP mode.</strong>
              Open your editor agent (Claude Code, Cursor, Windsurf, …) and run
              <code>/annotask-init</code> to scan this project, then
              <code>/annotask-apply</code> for pending tasks. Or call the MCP
              server directly at
              <code>http://localhost:5173/__annotask/mcp</code>.
            </div>
          </div>

          <!-- Agent mode — sub-control: how aggressively the embedded agent runs.
               Disabled when the top-level toggle above is off. -->
          <div
            class="settings-section"
            :class="{ 'settings-section--disabled': !embeddedAgentOn }"
            :aria-disabled="!embeddedAgentOn"
          >
            <label class="settings-label">Agent mode</label>
            <p v-if="!embeddedAgentOn" class="settings-desc">
              Enable the embedded agent above to change how it runs.
            </p>
            <AgentModePanel />
          </div>

          <!-- Current spec summary -->
          <div class="settings-section">
            <label class="settings-label">Design spec status</label>
            <div v-if="specInitialized" class="proj-spec-summary">
              <div class="proj-spec-row">
                <span class="proj-spec-key">Framework</span>
                <span class="proj-spec-val">{{ specFramework }}</span>
              </div>
              <div class="proj-spec-row">
                <span class="proj-spec-key">Themes</span>
                <span class="proj-spec-val">{{ specThemes }}</span>
              </div>
              <div class="proj-spec-row">
                <span class="proj-spec-key">Colors</span>
                <span class="proj-spec-val">{{ specColorCount }} token{{ specColorCount === 1 ? '' : 's' }}</span>
              </div>
              <div class="proj-spec-row">
                <span class="proj-spec-key">Typography</span>
                <span class="proj-spec-val">{{ specTypoCount }} entries</span>
              </div>
              <div v-if="specComponents" class="proj-spec-row">
                <span class="proj-spec-key">Components</span>
                <span class="proj-spec-val">{{ specComponents }}</span>
              </div>
            </div>
            <p v-else class="settings-desc" style="color: var(--warning)">
              Project not initialized — open the init wizard to set up the design spec.
            </p>
          </div>

          <!-- Actions -->
          <div class="settings-section">
            <label class="settings-label">Setup wizard</label>
            <template v-if="specInitialized">
              <p class="settings-desc">
                Re-run the full setup wizard. Each scan is optional — pick what
                you want to refresh, or skip straight to Review to edit the
                current tokens, style guide, and agent directions in place.
              </p>
              <button class="proj-reinit-btn" @click="openReinit">
                Re-init
              </button>
            </template>
            <template v-else>
              <p class="settings-desc">
                Run the setup wizard to scan your project and configure Annotask.
              </p>
              <button class="proj-reinit-btn" @click="openReinit">
                Open setup wizard
              </button>
            </template>
          </div>
        </section>

        <!-- Appearance tab — preserved verbatim. -->
        <section v-else class="settings-page" aria-label="Appearance settings">
          <h2 class="settings-page-title">Appearance</h2>

          <div class="settings-section">
            <label class="settings-label">Theme</label>
            <p class="settings-desc">Pick a shell theme that contrasts with your app.</p>

            <label class="settings-system-toggle">
              <input type="checkbox" :checked="shellTheme.activeThemeId.value === 'system'"
                @change="onSystemToggle(($event.target as HTMLInputElement).checked)" />
              <span>Use system preference</span>
            </label>

            <template v-for="group in themeGroups" :key="group.key">
              <template v-if="themesInGroup(group.key).length">
                <div class="settings-group-label">{{ group.label }}</div>
                <div class="settings-theme-grid">
                  <button
                    v-for="t in themesInGroup(group.key)"
                    :key="t.id"
                    :class="['settings-theme-card', { active: isActiveTheme(t.id) }]"
                    @click="shellTheme.setTheme(t.id)"
                    :title="t.description"
                  >
                    <div class="theme-card-swatches">
                      <span class="theme-swatch" :style="{ background: t.colors.bg }" />
                      <span class="theme-swatch" :style="{ background: t.colors.surface }" />
                      <span class="theme-swatch" :style="{ background: t.colors.accent }" />
                      <span class="theme-swatch" :style="{ background: t.colors.danger }" />
                      <span class="theme-swatch" :style="{ background: t.colors.text }" />
                    </div>
                    <span class="theme-card-name">{{ t.name }}</span>
                  </button>
                </div>
              </template>
            </template>
            <button class="settings-create-btn" @click="$emit('update:showThemeEditor', true)">+ Create Custom Theme</button>
          </div>
        </section>
      </div>
    </div>
    <ShellThemeEditor v-if="showThemeEditor" @close="$emit('update:showThemeEditor', false)" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import FullscreenOverlayHeader from './FullscreenOverlayHeader.vue'
import ShellThemeEditor from './ShellThemeEditor.vue'
import AgentsPanel from './AgentsPanel.vue'
import { useDesignSpec } from '../composables/useDesignSpec'
import { useInitFlow } from '../composables/useInitFlow'
import { useProviderSettings } from '../composables/useProviderSettings'
import { fetchAgentDetect, useAgentDetect } from '../composables/useTaskThread'
import Icon, { type IconName } from './Icon.vue'
import type { useShellTheme } from '../composables/useShellTheme'
import ProviderSettingsPanel from './ProviderSettingsPanel.vue'
import AgentModePanel from './AgentModePanel.vue'
import UsagePanel from './UsagePanel.vue'
import type { ProviderId } from '../../embedded/provider-config'

type TabId = 'general' | 'providers' | 'agents' | 'appearance'
type ProvidersSubTab = 'config' | 'usage'

// ── LLM Providers tab: shared provider picker (lives in the tab header so
// both sub-tabs see the same active provider) ─────────────────────────────
const providerSettings = useProviderSettings()
const detect = useAgentDetect()

const CLI_PROVIDER_IDS = ['claude-local', 'codex-local', 'opencode-local', 'copilot-local'] as const satisfies readonly ProviderId[]
type CliProviderId = typeof CLI_PROVIDER_IDS[number]

const providerMeta: Record<CliProviderId, { short: string }> = {
  'claude-local':   { short: 'Claude'   },
  'codex-local':    { short: 'Codex'    },
  'opencode-local': { short: 'opencode' },
  'copilot-local':  { short: 'Copilot'  },
}

const STATUS_LABEL = {
  ready: 'Ready',
  unauth: 'Not logged in',
  missing: 'Not installed',
  probing: 'Probing…',
} as const

function statusForCli(id: CliProviderId): keyof typeof STATUS_LABEL {
  const snap = detect.snapshot.value
  if (!snap) return 'probing'
  const s = snap[id]
  if (!s || !s.found) return 'missing'
  if (!s.loggedIn) return 'unauth'
  return 'ready'
}

// Detection drives the picker badges and the readiness banner in the
// Providers sub-tab. Fetch once when settings opens.
onMounted(() => { fetchAgentDetect() })

// Snap active provider to a local CLI if the user landed here with a stale
// HTTP provider stored as active (pre-CLI-only change). Fires before either
// sub-tab renders so Usage's `byProvider[active]` lookup always hits a CLI.
watch(
  () => providerSettings.activeProvider.value,
  (id) => {
    if (!(CLI_PROVIDER_IDS as readonly ProviderId[]).includes(id)) {
      providerSettings.setActiveProvider('claude-local')
    }
  },
  { immediate: true },
)

interface Props {
  shellTheme: ReturnType<typeof useShellTheme>
  showThemeEditor: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:showThemeEditor', value: boolean): void
}>()

const tabs: Array<{ id: TabId; label: string; icon: IconName }> = [
  { id: 'general',    label: 'General',       icon: 'settings' },
  { id: 'providers',  label: 'LLM Providers', icon: 'sliders-horizontal' },
  { id: 'agents',     label: 'Agents',        icon: 'bot' },
  { id: 'appearance', label: 'Appearance',    icon: 'palette' },
]

// LLM Providers has two sub-views: provider config (the panel) and usage
// (cumulative token metrics). Defaults to config when first opening the tab.
const providersSubTab = ref<ProvidersSubTab>('config')

// ── Project tab ──────────────────────────────────────────
const { designSpec, isInitialized: specInitialized } = useDesignSpec()
const initFlow = useInitFlow()

const specFramework = computed(() => {
  const fw = designSpec.value?.framework
  if (!fw) return '—'
  return [fw.name, fw.version].filter(Boolean).join(' ') + (fw.styling?.length ? ` (${fw.styling.join(', ')})` : '')
})

const specThemes = computed(() => {
  const themes = designSpec.value?.themes
  if (!themes?.length) return '—'
  return themes.map((t: any) => t.name || t.id).join(', ')
})

const specColorCount = computed(() => designSpec.value?.colors?.length ?? 0)

const specTypoCount = computed(() => {
  const t = designSpec.value?.typography
  return (t?.families?.length ?? 0) + (t?.scale?.length ?? 0)
})

const specComponents = computed(() => {
  const c = designSpec.value?.components
  if (!c?.library) return null
  return [c.library, c.version].filter(Boolean).join(' ')
})

function openReinit() {
  emit('close')
  // Re-init runs the full init flow (agent → scan → review → save). The
  // `rescan: true` flag is what marks individual scans as opt-in/skippable.
  if (specInitialized.value) {
    initFlow.openWizard('agent', { rescan: true })
  } else {
    initFlow.openWizard('agent')
  }
}

// True when the embedded-agent feature is on. Treats the first-run `null`
// (user hasn't decided yet) the same as off — until they pick, no embedded
// surface should claim to be enabled.
const embeddedAgentOn = computed(() =>
  providerSettings.settings.value.embeddedAgentEnabled === true,
)

function onEmbeddedAgentToggle(on: boolean) {
  providerSettings.setEmbeddedAgentEnabled(on)
  // Flipping on from off → drop the user into the provider-setup step so
  // they can actually pick a CLI before the embedded UI starts spawning
  // anything. (No-op when the project is already initialized — they can
  // still re-open from Setup wizard below if they want a re-scan.)
  if (on && !specInitialized.value) {
    emit('close')
    initFlow.openWizard('agent')
  }
}

const activeTab = ref<TabId>('general')

const themeGroups = [
  { key: 'default', label: 'Default' },
  { key: 'high-contrast', label: 'High Contrast' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'editor', label: 'Editor Themes' },
  { key: 'custom', label: 'Custom' },
] as const

function themesInGroup(groupKey: string) {
  return props.shellTheme.allThemes.value.filter((t) => t.group === groupKey)
}

function isActiveTheme(themeId: string): boolean {
  const st = props.shellTheme
  return st.activeThemeId.value === 'system'
    ? st.resolvedTheme.value.id === themeId
    : st.activeThemeId.value === themeId
}

function onSystemToggle(useSystem: boolean) {
  const st = props.shellTheme
  st.setTheme(useSystem ? 'system' : st.resolvedTheme.value.id)
}
</script>

<style scoped>
/* Agents tab needs more horizontal room for the persona table than the
   default 560px settings-page width. */
.settings-page.settings-page--wide {
  max-width: 960px;
}

/* ── Embedded-agent toggle (General tab) ── */
.embedded-toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.embedded-toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}
.embedded-toggle input { position: absolute; opacity: 0; pointer-events: none; }
.embedded-toggle-track {
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  position: relative;
  transition: background 120ms ease, border-color 120ms ease;
}
.embedded-toggle-thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text-muted);
  transition: transform 120ms ease, background 120ms ease;
}
.embedded-toggle input:checked + .embedded-toggle-track {
  background: color-mix(in srgb, var(--accent) 30%, var(--surface-3));
  border-color: var(--accent);
}
.embedded-toggle input:checked + .embedded-toggle-track .embedded-toggle-thumb {
  transform: translateX(14px);
  background: var(--accent);
}
.embedded-toggle input:focus-visible + .embedded-toggle-track {
  box-shadow: 0 0 0 2px var(--focus-ring);
}
.embedded-toggle-text { font-size: 12px; font-weight: 600; color: var(--text); }
.embedded-toggle-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--warning) 18%, transparent);
  color: var(--warning);
}
.skill-mode-banner {
  margin-top: 10px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--info) 8%, var(--surface-2));
  border: 1px solid color-mix(in srgb, var(--info) 30%, var(--border));
  border-radius: 6px;
  font-size: 12px;
  color: var(--text);
  line-height: 1.55;
}
.skill-mode-banner code {
  background: var(--surface-3);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
}
.settings-section--disabled {
  opacity: 0.55;
  pointer-events: none;
}
/* Re-enable the heading + helper text inside a disabled section so the user
   can still read what's gated. Only the interactive children are dimmed. */
.settings-section--disabled .settings-label,
.settings-section--disabled .settings-desc {
  opacity: 1;
  pointer-events: auto;
}

/* ── Project tab ── */
.proj-spec-summary {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  margin-top: 8px;
}
.proj-spec-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.proj-spec-row:last-child { border-bottom: none; }
.proj-spec-key {
  width: 90px;
  flex-shrink: 0;
  font-weight: 600;
  color: var(--text-muted);
  font-size: 11px;
}
.proj-spec-val {
  color: var(--text);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 11.5px;
}

.proj-reinit-btn {
  margin-top: 8px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 9px 18px;
  border-radius: 6px;
  background: var(--accent);
  color: var(--text-on-accent);
  border: none;
  cursor: pointer;
  transition: background 120ms;
}
.proj-reinit-btn:hover { background: var(--accent-hover); }

.settings-layout {
  flex: 1;
  display: flex;
  min-height: 0;
}

.settings-sidebar {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-nav-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  text-align: left;
  width: 100%;
  transition: background 120ms ease, color 120ms ease;
}

.settings-nav-btn:hover { background: var(--surface-2); }
.settings-nav-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.settings-nav-btn.active {
  background: var(--accent-muted);
  color: var(--text);
  font-weight: 600;
}
.settings-nav-btn.active :deep(svg) { color: var(--accent); }

.settings-page-lead {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.55;
  margin: -10px 0 24px;
  max-width: 560px;
}
.settings-page-lead strong { color: var(--text); font-weight: 600; }

/* ── LLM Providers tab header (title left, provider picker right) ── */
.settings-page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.settings-page-header .settings-page-title { margin-bottom: 0; }
.settings-page-header-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.settings-page-header-text .settings-page-lead { margin: 0; }

.provider-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  min-width: 240px;
}
.provider-picker-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.provider-picker-select {
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text);
}
.provider-picker-select:focus { outline: none; border-color: var(--accent); }
.provider-picker-select:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }

/* ── Sub-tabs (LLM Providers: Providers | Usage) ──
 * Classic page-tab treatment: horizontal labels with a colored underline
 * under the active one, sharing a bottom border with the whole strip.
 * Distinct from the segmented "toggle" pill used for Agent mode and the
 * permission chip — those convey "pick one of N modes"; these convey
 * "switch between sub-pages of the same screen." */
.settings-subtabs {
  display: flex;
  gap: 4px;
  margin: 0 0 20px;
  border-bottom: 1px solid var(--border);
}
.settings-subtab {
  position: relative;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 9px 14px 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  /* Reserve the underline thickness so hover/focus don't reflow neighbors. */
  margin-bottom: -1px;
  border-bottom: 2px solid transparent;
  transition: color 120ms ease, border-color 120ms ease;
}
.settings-subtab:hover:not(.active) { color: var(--text); }
.settings-subtab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: 3px 3px 0 0;
}
.settings-subtab.active {
  color: var(--text);
  font-weight: 600;
  border-bottom-color: var(--accent);
}

@media (max-width: 640px) {
  .settings-layout { flex-direction: column; }
  .settings-sidebar {
    width: auto;
    flex-direction: row;
    border-right: none;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    padding: 6px 10px;
    gap: 4px;
  }
  .settings-nav-btn {
    flex: 0 0 auto;
    width: auto;
    padding: 6px 12px;
    white-space: nowrap;
  }
}
</style>
