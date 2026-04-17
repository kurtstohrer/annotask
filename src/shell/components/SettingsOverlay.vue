<template>
  <div class="fullscreen-overlay settings-overlay">
    <FullscreenOverlayHeader title="Settings" @close="$emit('close')" />
    <div class="settings-content">
      <div class="settings-page">
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
      </div>
    </div>
    <ShellThemeEditor v-if="showThemeEditor" @close="$emit('update:showThemeEditor', false)" />
  </div>
</template>

<script setup lang="ts">
import FullscreenOverlayHeader from './FullscreenOverlayHeader.vue'
import ShellThemeEditor from './ShellThemeEditor.vue'
import type { useShellTheme } from '../composables/useShellTheme'

interface Props {
  shellTheme: ReturnType<typeof useShellTheme>
  showThemeEditor: boolean
}

const props = defineProps<Props>()
defineEmits<{
  (e: 'close'): void
  (e: 'update:showThemeEditor', value: boolean): void
}>()

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
