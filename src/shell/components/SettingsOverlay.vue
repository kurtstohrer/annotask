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
        <!-- AI tab — Anthropic BYOK + model + cap (ANN-4 surface). -->
        <section v-if="activeTab === 'ai'" class="settings-page" aria-label="AI settings">
          <h2 class="settings-page-title">AI</h2>
          <p class="settings-page-lead">
            Anthropic BYOK for the embedded agent loop. Provider-specific keys
            (OpenAI, Copilot, opencode, Paperclip) live under <strong>Providers</strong>.
          </p>
          <AISettingsPanel />
        </section>

        <!-- Providers tab — multi-provider config + cap + guardrails. -->
        <section v-else-if="activeTab === 'providers'" class="settings-page" aria-label="Provider settings">
          <h2 class="settings-page-title">Providers</h2>
          <p class="settings-page-lead">
            Choose which model service the embedded chat calls. All credentials
            stay in your browser.
          </p>
          <ProviderSettingsPanel />
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
import { ref } from 'vue'
import FullscreenOverlayHeader from './FullscreenOverlayHeader.vue'
import ShellThemeEditor from './ShellThemeEditor.vue'
import AISettingsPanel from './AISettingsPanel.vue'
import ProviderSettingsPanel from './ProviderSettingsPanel.vue'
import Icon, { type IconName } from './Icon.vue'
import type { useShellTheme } from '../composables/useShellTheme'

type TabId = 'ai' | 'providers' | 'appearance'

interface Props {
  shellTheme: ReturnType<typeof useShellTheme>
  showThemeEditor: boolean
}

const props = defineProps<Props>()
defineEmits<{
  (e: 'close'): void
  (e: 'update:showThemeEditor', value: boolean): void
}>()

const tabs: Array<{ id: TabId; label: string; icon: IconName }> = [
  { id: 'ai', label: 'AI', icon: 'bot' },
  { id: 'providers', label: 'Providers', icon: 'sliders-horizontal' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
]

const activeTab = ref<TabId>('ai')

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
