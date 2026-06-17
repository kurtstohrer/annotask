<script setup lang="ts">
import { ref, computed, type Ref } from 'vue'
import { useDesignSpec } from '../composables/useDesignSpec'
import { useThemePreview } from '../composables/useThemePreview'
import { useTasks } from '../composables/useTasks'
import type { DesignSpecThemeSelector, ColorSchemeInfo } from '../../schema'
import type { ColorSchemeResult } from '../../shared/bridge-types'
import ThemeLibrariesTab from './ThemeLibrariesTab.vue'
import DesignTokenEditor from './DesignTokenEditor.vue'
import Icon from './Icon.vue'

const props = defineProps<{
  iframeRef: HTMLIFrameElement | null
  getColorScheme: () => Promise<ColorSchemeInfo | null>
  /** Live iframe color scheme. When omitted, variant auto-selection falls back to defaultTheme. */
  colorScheme?: ColorSchemeResult | null
  /**
   * Drive the iframe into a specific variant by applying its selector
   * (data-attribute or class). Called when the user clicks a variant tab so
   * the app actually switches — without this, clicking only pins the edit
   * target and the user has to toggle the app manually to preview.
   */
  activateColorScheme?: (selector: DesignSpecThemeSelector | null | undefined, all?: DesignSpecThemeSelector[]) => Promise<void>
}>()

const { designSpec, isInitialized, isLoading } = useDesignSpec()
const themePreview = useThemePreview(
  computed(() => props.iframeRef) as Ref<HTMLIFrameElement | null>
)
const taskSystem = useTasks()

const editorRef = ref<InstanceType<typeof DesignTokenEditor> | null>(null)
const activeLibrariesTab = ref(false)

const totalChanges = computed(() => editorRef.value?.totalChanges ?? 0)

async function activateVariant(selector: import('../../schema').DesignSpecThemeSelector | null | undefined, all?: import('../../schema').DesignSpecThemeSelector[]) {
  if (!props.activateColorScheme) return
  themePreview.clearAll()
  await props.activateColorScheme(selector ?? null, all)
}

async function commitChanges() {
  const editor = editorRef.value
  if (!editor) return
  const edits = editor.collectEdits()
  if (edits.length === 0) { editor.resetEdits(); return }
  const styling = designSpec.value?.framework?.styling ?? []
  const variantCount = new Set(edits.map((e: any) => e.theme_variant)).size
  const variantSuffix = variantCount > 1 ? ` across ${variantCount} variants` : ''
  const anchorEdit = edits.find((e: any) => e.sourceFile) ?? edits[0]
  const task = {
    type: 'theme_update' as const, action: 'theme_update',
    description: `Update ${edits.length} design token${edits.length === 1 ? '' : 's'}${variantSuffix}`,
    file: (anchorEdit as any).sourceFile || '', line: (anchorEdit as any).sourceLine || 0,
    intent: 'Apply the listed token edits to their source CSS/config files, then patch .annotask/design-spec.json.',
    context: { styling, specFile: '.annotask/design-spec.json', edits },
  }
  const colorScheme = await props.getColorScheme()
  await taskSystem.createTask(colorScheme ? { ...task, color_scheme: colorScheme } : task)
  editor.resetEdits()
}

function discardChanges() {
  editorRef.value?.resetEdits()
  themePreview.clearAll()
}
</script>

<template>
  <div class="theme-page">
    <!-- Commit/discard bar -->
    <div class="theme-header">
      <span class="theme-title">Design Tokens</span>
      <div v-if="totalChanges > 0" class="theme-actions">
        <span class="theme-change-count">{{ totalChanges }} change{{ totalChanges === 1 ? '' : 's' }}</span>
        <button class="theme-btn commit" @click="commitChanges">Commit</button>
        <button class="theme-btn discard" @click="discardChanges">Discard</button>
      </div>
      <!-- Libraries tab toggle lives here since DesignTokenEditor doesn't render it -->
      <button v-else :class="['theme-btn small', { active: activeLibrariesTab }]" @click="activeLibrariesTab = !activeLibrariesTab">Libraries</button>
    </div>

    <div v-if="isLoading" class="theme-empty">
      <p>Loading design spec...</p>
    </div>
    <div v-else-if="!isInitialized" class="theme-empty">
      <Icon name="clock" :size="32" :stroke-width="1.5" style="opacity: 0.3" />
      <p>No design spec found</p>
      <p class="theme-empty-hint">Run <code>/annotask-init</code> in your AI assistant to scan your project's design system</p>
    </div>

    <template v-else>
      <ThemeLibrariesTab v-if="activeLibrariesTab" :design-spec="designSpec ?? null" />
      <DesignTokenEditor
        v-else
        ref="editorRef"
        :spec="designSpec as Record<string, any> | null"
        :on-activate-variant="activateVariant"
      />
    </template>
  </div>
</template>

<style scoped>
.theme-page { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.theme-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.theme-title { font-size: 13px; font-weight: 600; color: var(--text); }
.theme-actions { display: flex; align-items: center; gap: 8px; }
.theme-change-count { font-size: 11px; color: var(--text-muted); }
.theme-btn { padding: 4px 12px; font-size: 11px; font-weight: 600; border: none; border-radius: 5px; cursor: pointer; }
.theme-btn.commit { background: var(--accent); color: white; }
.theme-btn.commit:hover { opacity: 0.9; }
.theme-btn.commit:disabled { opacity: 0.4; cursor: not-allowed; }
.theme-btn.discard { background: var(--surface-2); color: var(--text-muted); border: 1px solid var(--border); }
.theme-btn.discard:hover { color: var(--text); background: var(--border); }
.theme-btn.small { padding: 3px 10px; font-size: 10px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); }
.theme-btn.small:hover { color: var(--text); }
.theme-btn.small.active { color: var(--accent); border-color: var(--accent); }

/* Empty state */
.theme-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--text-muted); text-align: center; padding: 24px; }
.theme-empty p { font-size: 13px; }
.theme-empty-hint { font-size: 11px; opacity: 0.7; }
.theme-empty code { background: color-mix(in srgb, var(--accent) 15%, transparent); padding: 1px 6px; border-radius: 3px; font-weight: 600; color: var(--text-link); }
</style>
