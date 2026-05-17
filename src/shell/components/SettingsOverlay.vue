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

        <!-- Project tab — design-spec status + re-init. -->
        <section v-else-if="activeTab === 'project'" class="settings-page" aria-label="Project setup">
          <h2 class="settings-page-title">Project setup</h2>
          <p class="settings-page-lead">
            View the current design-spec and run the init wizard again to
            re-scan the project, refresh tokens, or update the style guide.
          </p>

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
import { ref, computed } from 'vue'
import FullscreenOverlayHeader from './FullscreenOverlayHeader.vue'
import ShellThemeEditor from './ShellThemeEditor.vue'
import AgentsPanel from './AgentsPanel.vue'
import { useDesignSpec } from '../composables/useDesignSpec'
import { useInitFlow } from '../composables/useInitFlow'
import Icon, { type IconName } from './Icon.vue'
import type { useShellTheme } from '../composables/useShellTheme'

type TabId = 'project' | 'agents' | 'appearance'

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
  { id: 'project',    label: 'Project',    icon: 'settings' },
  { id: 'agents',     label: 'Agents',     icon: 'bot' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
]

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

const activeTab = ref<TabId>('project')

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
