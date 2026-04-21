<script setup lang="ts">
import { ref, computed, watch, type Ref, type MaybeRef, toRef } from 'vue'
import { useDesignSpec } from '../composables/useDesignSpec'
import { useThemePreview } from '../composables/useThemePreview'
import { useTasks } from '../composables/useTasks'
import type { DesignSpecToken, DesignSpecTheme, DesignSpecThemeSelector, ColorSchemeInfo } from '../../schema'
import type { ColorSchemeResult } from '../../shared/bridge-types'
import ColorPalettePicker from './ColorPalettePicker.vue'
import ThemeLibrariesTab from './ThemeLibrariesTab.vue'
import ThemeAddTokenForm from './ThemeAddTokenForm.vue'
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

const activeSection = ref<'colors' | 'typography' | 'spacing' | 'borders' | 'libraries'>('colors')

// ── Theme variants ──
// Every token stores per-variant values keyed by theme id. `activeThemeId`
// drives which value the UI shows and which variant edits are attributed to.
const FALLBACK_THEME: DesignSpecTheme = { id: 'default', name: 'Default', selector: { kind: 'default' } }

const themes = computed<DesignSpecTheme[]>(() => {
  const list = designSpec.value?.themes
  return Array.isArray(list) && list.length > 0 ? list : [FALLBACK_THEME]
})

const defaultThemeId = computed(() =>
  designSpec.value?.defaultTheme || themes.value[0]?.id || 'default'
)

/** User-pinned variant (null = follow the iframe). */
const pinnedThemeId = ref<string | null>(null)

/**
 * Match the iframe's detected color scheme to one of the spec's theme variants.
 * Preference order:
 *   1. Exact DOM marker match — most reliable (e.g. data-bs-theme="dark")
 *   2. Scheme classification — theme whose `scheme` field matches light/dark
 *   3. Default theme id from the spec
 */
function matchTheme(cs: ColorSchemeResult | null | undefined, list: DesignSpecTheme[], fallback: string): string {
  if (!cs) return fallback
  if (cs.marker) {
    const m = cs.marker
    for (const t of list) {
      const sel = t.selector
      if (m.kind === 'attribute' && sel.kind === 'attribute' && sel.name === m.name && (sel.value === undefined || sel.value === m.value) && (sel.host === undefined || sel.host === m.host)) return t.id
      if (m.kind === 'class' && sel.kind === 'class' && sel.name === m.name && (sel.host === undefined || sel.host === m.host)) return t.id
    }
  }
  for (const t of list) if (t.scheme === cs.scheme) return t.id
  return fallback
}

const detectedThemeId = computed(() => matchTheme(props.colorScheme ?? null, themes.value, defaultThemeId.value))
const activeThemeId = computed(() => pinnedThemeId.value ?? detectedThemeId.value)
const activeTheme = computed<DesignSpecTheme>(() =>
  themes.value.find(t => t.id === activeThemeId.value) ?? themes.value[0]
)

/**
 * Live preview is only safe when the variant being edited matches what the
 * iframe is actually rendering. Otherwise we'd paint dark-theme overrides
 * onto a light-mode viewport (or vice versa) and mislead the user.
 */
const previewMatchesIframe = computed(() => activeThemeId.value === detectedThemeId.value)

function setActiveTheme(id: string) {
  const target = themes.value.find(t => t.id === id)
  if (!target) return
  themePreview.clearAll()
  // Drive the iframe into this variant when the selector is one we can apply
  // from JS (attribute or class). Media-query variants can't be forced — those
  // just pin the edit target and show a hint. `default` means clear all sibling
  // markers, which the plugin handles.
  const canDrive = target.selector.kind === 'attribute'
    || target.selector.kind === 'class'
    || target.selector.kind === 'default'
  if (canDrive && props.activateColorScheme) {
    pinnedThemeId.value = null
    const selectors = themes.value.map(t => t.selector)
    void props.activateColorScheme(target.selector, selectors)
    return
  }
  // Fallback: can't drive this variant — just pin the edit target.
  pinnedThemeId.value = id === detectedThemeId.value ? null : id
}
function followIframe() {
  pinnedThemeId.value = null
  themePreview.clearAll()
}

// Clear any stale preview overrides whenever the active variant changes — we
// don't want light edits bleeding into dark view or across theme swaps.
watch(activeThemeId, () => themePreview.clearAll())

// ── Editing state ──
// Edit maps are keyed by `${themeId}::${role}` so edits in different variants
// don't collide. `newTokens` keep their values map directly on the token.
function editKey(themeId: string, role: string) { return `${themeId}::${role}` }

const editedColors = ref<Map<string, string>>(new Map())
const editedFamilies = ref<Map<string, string>>(new Map())
const editedScale = ref<Map<string, string>>(new Map())
const editedSpacing = ref<Map<string, string>>(new Map())
const editedRadius = ref<Map<string, string>>(new Map())

const newColors = ref<DesignSpecToken[]>([])
const newFamilies = ref<DesignSpecToken[]>([])
const newScale = ref<DesignSpecToken[]>([])
const newSpacing = ref<DesignSpecToken[]>([])
const newRadius = ref<DesignSpecToken[]>([])

const addingNew = ref<string | null>(null)

// ── Computed token lists ──
const colors = computed(() => designSpec.value?.colors ?? [])
const families = computed(() => designSpec.value?.typography?.families ?? [])
const scale = computed(() => designSpec.value?.typography?.scale ?? [])
const weights = computed(() => designSpec.value?.typography?.weights ?? [])
const spacing = computed(() => designSpec.value?.spacing ?? [])
const radius = computed(() => designSpec.value?.borders?.radius ?? [])
const icons = computed(() => designSpec.value?.icons ?? null)
const components = computed(() => designSpec.value?.components ?? null)

/** Count edits across ALL variants, not just the active one. */
function countEditsForSection(editMap: Map<string, string>, tokens: DesignSpecToken[]): number {
  let n = 0
  for (const t of tokens) {
    for (const tid of Object.keys(t.values || {})) {
      if (editMap.has(editKey(tid, t.role))) n++
    }
  }
  return n
}

const colorEditCount = computed(() => countEditsForSection(editedColors.value, colors.value))
const familyEditCount = computed(() => countEditsForSection(editedFamilies.value, families.value))
const scaleEditCount = computed(() => countEditsForSection(editedScale.value, scale.value))
const spacingEditCount = computed(() => countEditsForSection(editedSpacing.value, spacing.value))
const radiusEditCount = computed(() => countEditsForSection(editedRadius.value, radius.value))

const totalChanges = computed(() =>
  colorEditCount.value + familyEditCount.value + scaleEditCount.value +
  spacingEditCount.value + radiusEditCount.value +
  newColors.value.length + newFamilies.value.length + newScale.value.length +
  newSpacing.value.length + newRadius.value.length
)

// ── Token value helpers ──
function originalValue(token: DesignSpecToken): string {
  const values = token.values || {}
  // Prefer the active variant, then the spec's default, then any value in the map.
  const v = values[activeThemeId.value] ?? values[defaultThemeId.value]
  if (v !== undefined) return v
  const first = Object.values(values)[0]
  return first ?? ''
}

function getEffectiveValue(token: DesignSpecToken, editMap: MaybeRef<Map<string, string>>): string {
  const map = toRef(editMap).value
  return map.get(editKey(activeThemeId.value, token.role)) ?? originalValue(token)
}

function isEdited(token: DesignSpecToken, editMap: MaybeRef<Map<string, string>>): boolean {
  const map = toRef(editMap).value
  const edited = map.get(editKey(activeThemeId.value, token.role))
  return edited !== undefined && edited !== originalValue(token)
}

// ── Edit handlers ──
function onColorChange(token: DesignSpecToken, value: string) {
  editedColors.value.set(editKey(activeThemeId.value, token.role), value)
  editedColors.value = new Map(editedColors.value)
  if (token.cssVar && previewMatchesIframe.value) themePreview.setOverride(token.cssVar, value)
}

function onTokenChange(
  token: DesignSpecToken,
  value: string,
  editMap: MaybeRef<Map<string, string>>
) {
  const r = toRef(editMap)
  r.value.set(editKey(activeThemeId.value, token.role), value)
  r.value = new Map(r.value)
  if (token.cssVar && previewMatchesIframe.value) themePreview.setOverride(token.cssVar, value)
}

// ── Add new token ──
function startAdd(section: string) { addingNew.value = section }
function cancelAdd() { addingNew.value = null }

function confirmAdd(payload: { role: string; value: string; cssVar?: string }) {
  // New tokens are scoped to the active variant only. Other variants start
  // blank so the commit task can ask the agent to decide the right value.
  const token: DesignSpecToken = {
    role: payload.role,
    values: { [activeThemeId.value]: payload.value },
    cssVar: payload.cssVar,
    source: 'new',
  }
  switch (addingNew.value) {
    case 'colors': newColors.value = [...newColors.value, token]; break
    case 'families': newFamilies.value = [...newFamilies.value, token]; break
    case 'scale': newScale.value = [...newScale.value, token]; break
    case 'spacing': newSpacing.value = [...newSpacing.value, token]; break
    case 'radius': newRadius.value = [...newRadius.value, token]; break
  }
  if (token.cssVar && previewMatchesIframe.value) themePreview.setOverride(token.cssVar, payload.value)
  addingNew.value = null
}

function removeNew(list: MaybeRef<DesignSpecToken[]>, index: number) {
  const r = toRef(list)
  const token = r.value[index]
  if (token.cssVar) themePreview.removeOverride(token.cssVar)
  r.value = r.value.filter((_, i) => i !== index)
}

function newTokenDisplayValue(token: DesignSpecToken): string {
  return token.values[activeThemeId.value] ?? Object.values(token.values)[0] ?? ''
}

// ── Commit ──
/**
 * Every Commit produces a single `theme_update` task carrying all edits in
 * `context.edits[]`. The agent groups by `sourceFile`, applies edits per file
 * in one pass, then patches `.annotask/design-spec.json` so the Theme page
 * hot-reloads from the updated spec (the server's file watcher broadcasts
 * `designspec:updated` on write).
 */
interface ThemeEdit {
  category: string
  role: string
  cssVar: string | null
  theme_variant: string
  theme_selector: DesignSpecTheme['selector'] | null
  before: string | null
  after: string
  sourceFile: string | null
  sourceLine: number | null
  isNew: boolean
}

function collectEdits(): ThemeEdit[] {
  const edits: ThemeEdit[] = []

  function pushEditsFor(category: string, token: DesignSpecToken, editMap: Map<string, string>) {
    for (const themeId of Object.keys(token.values || {})) {
      const after = editMap.get(editKey(themeId, token.role))
      const before = token.values[themeId]
      if (after === undefined || after === before) continue
      const variant = themes.value.find(t => t.id === themeId)
      edits.push({
        category,
        role: token.role,
        cssVar: token.cssVar || null,
        theme_variant: themeId,
        theme_selector: variant?.selector ?? null,
        before,
        after,
        sourceFile: token.sourceFile || null,
        sourceLine: token.sourceLine || null,
        isNew: false,
      })
    }
  }

  function pushNewFor(category: string, token: DesignSpecToken) {
    // A staged new token may carry multiple variant values at once — emit one
    // edit per variant so the agent adds the variable to every relevant block.
    const entries = Object.entries(token.values || {})
    if (entries.length === 0) {
      // No variant values specified — fall back to the active variant with an
      // empty string so the agent has a placeholder location.
      entries.push([activeThemeId.value, ''])
    }
    for (const [themeId, value] of entries) {
      const variant = themes.value.find(t => t.id === themeId)
      edits.push({
        category,
        role: token.role,
        cssVar: token.cssVar || null,
        theme_variant: themeId,
        theme_selector: variant?.selector ?? null,
        before: null,
        after: value ?? '',
        sourceFile: null,
        sourceLine: null,
        isNew: true,
      })
    }
  }

  for (const token of colors.value) pushEditsFor('colors', token, editedColors.value)
  for (const token of families.value) pushEditsFor('typography.families', token, editedFamilies.value)
  for (const token of scale.value) pushEditsFor('typography.scale', token, editedScale.value)
  for (const token of spacing.value) pushEditsFor('spacing', token, editedSpacing.value)
  for (const token of radius.value) pushEditsFor('borders.radius', token, editedRadius.value)

  for (const token of newColors.value) pushNewFor('colors', token)
  for (const token of newFamilies.value) pushNewFor('typography.families', token)
  for (const token of newScale.value) pushNewFor('typography.scale', token)
  for (const token of newSpacing.value) pushNewFor('spacing', token)
  for (const token of newRadius.value) pushNewFor('borders.radius', token)

  return edits
}

function buildConsolidatedTask(): Record<string, unknown> | null {
  const edits = collectEdits()
  if (edits.length === 0) return null
  const styling = designSpec.value?.framework?.styling ?? []
  const variantCount = new Set(edits.map(e => e.theme_variant)).size
  const variantSuffix = variantCount > 1 ? ` across ${variantCount} variants` : ''
  // Anchor the task card at the first known source file so the task list
  // shows something meaningful — the agent must still read context.edits to
  // find every file.
  const anchorEdit = edits.find(e => e.sourceFile) ?? edits[0]
  return {
    type: 'theme_update',
    action: 'theme_update',
    description: `Update ${edits.length} design token${edits.length === 1 ? '' : 's'}${variantSuffix}`,
    file: anchorEdit.sourceFile || '',
    line: anchorEdit.sourceLine || 0,
    intent: 'Apply the listed token edits to their source CSS/config files, then patch .annotask/design-spec.json so the Theme page reflects the new values.',
    context: {
      styling,
      specFile: '.annotask/design-spec.json',
      edits,
    },
  }
}

/**
 * Clear edit state. Pass `clearPreview: false` on commit so the user keeps
 * seeing their colors in the iframe — the edits are now agent tasks, and the
 * real file change happens asynchronously. The preview naturally drops once
 * `designspec:updated` reloads the spec with the new base values.
 */
function resetEdits(opts: { clearPreview?: boolean } = { clearPreview: true }) {
  editedColors.value = new Map()
  editedFamilies.value = new Map()
  editedScale.value = new Map()
  editedSpacing.value = new Map()
  editedRadius.value = new Map()
  newColors.value = []
  newFamilies.value = []
  newScale.value = []
  newSpacing.value = []
  newRadius.value = []
  if (opts.clearPreview !== false) themePreview.clearAll()
}

async function commitChanges() {
  const task = buildConsolidatedTask()
  if (!task) { resetEdits(); return }
  const colorScheme = await props.getColorScheme()
  await taskSystem.createTask(colorScheme ? { ...task, color_scheme: colorScheme } : task)
  // Keep the preview live — the agent will update the source files shortly
  // and the `designspec:updated` WebSocket push will swap in the real values.
  resetEdits({ clearPreview: false })
}

function discardChanges() {
  resetEdits()
}
</script>

<template>
  <div class="theme-page">
    <!-- Header -->
    <div class="theme-header">
      <span class="theme-title">Design Tokens</span>
      <div v-if="totalChanges > 0" class="theme-actions">
        <span class="theme-change-count">{{ totalChanges }} change{{ totalChanges === 1 ? '' : 's' }}</span>
        <button class="theme-btn commit" @click="commitChanges">Commit</button>
        <button class="theme-btn discard" @click="discardChanges">Discard</button>
      </div>
    </div>

    <!-- Loading / Empty -->
    <div v-if="isLoading" class="theme-empty">
      <p>Loading design spec...</p>
    </div>
    <div v-else-if="!isInitialized" class="theme-empty">
      <Icon name="clock" :size="32" :stroke-width="1.5" style="opacity: 0.3" />
      <p>No design spec found</p>
      <p class="theme-empty-hint">Run <code>/annotask-init</code> in your AI assistant to scan your project's design system</p>
    </div>

    <template v-else>
      <!-- Variant tabs — only shown when the spec has more than one variant.
           The dot marks the variant the iframe is currently rendering; clicking
           a tab pins the Theme page to that variant so you can edit it even
           while viewing a different one in the iframe. -->
      <div v-if="themes.length > 1" class="variant-bar">
        <div class="variant-tabs">
          <button
            v-for="t in themes"
            :key="t.id"
            :class="['variant-tab', { active: t.id === activeThemeId, pinned: t.id === pinnedThemeId, detected: t.id === detectedThemeId }]"
            @click="setActiveTheme(t.id)"
            :title="t.id === detectedThemeId ? 'Currently active in iframe' : 'Click to edit this variant'"
          >
            <span v-if="t.id === detectedThemeId" class="variant-dot" />
            {{ t.name }}
          </button>
        </div>
        <button v-if="pinnedThemeId" class="variant-follow-btn" @click="followIframe" title="Resume auto-selecting the iframe's active variant">Follow iframe</button>
      </div>
      <div v-if="!previewMatchesIframe" class="variant-hint">
        Editing <strong>{{ activeTheme.name }}</strong> — switch the app to this variant in the iframe to preview changes.
      </div>

      <!-- Section tabs -->
      <div class="theme-tabs">
        <button :class="['theme-tab', { active: activeSection === 'colors' }]" @click="activeSection = 'colors'">
          Colors <span v-if="colorEditCount + newColors.length" class="theme-tab-badge">{{ colorEditCount + newColors.length }}</span>
        </button>
        <button :class="['theme-tab', { active: activeSection === 'typography' }]" @click="activeSection = 'typography'">
          Type <span v-if="familyEditCount + scaleEditCount + newFamilies.length + newScale.length" class="theme-tab-badge">{{ familyEditCount + scaleEditCount + newFamilies.length + newScale.length }}</span>
        </button>
        <button :class="['theme-tab', { active: activeSection === 'spacing' }]" @click="activeSection = 'spacing'">
          Spacing <span v-if="spacingEditCount + newSpacing.length" class="theme-tab-badge">{{ spacingEditCount + newSpacing.length }}</span>
        </button>
        <button :class="['theme-tab', { active: activeSection === 'borders' }]" @click="activeSection = 'borders'">
          Borders <span v-if="radiusEditCount + newRadius.length" class="theme-tab-badge">{{ radiusEditCount + newRadius.length }}</span>
        </button>
        <button :class="['theme-tab', { active: activeSection === 'libraries' }]" @click="activeSection = 'libraries'">Libraries</button>
      </div>

      <!-- Content -->
      <div class="theme-content">

        <!-- COLORS -->
        <div v-if="activeSection === 'colors'" class="theme-section">
          <div v-if="colors.length === 0 && newColors.length === 0" class="theme-section-empty">No color tokens detected</div>
          <div v-for="token in colors" :key="token.role" class="token-row">
            <div class="token-info">
              <span class="token-role" :class="{ edited: isEdited(token, editedColors) }">{{ token.role }}</span>
              <code class="token-source">{{ token.source }}</code>
            </div>
            <div class="token-controls">
              <div class="color-swatch-wrapper">
                <ColorPalettePicker
                  :modelValue="getEffectiveValue(token, editedColors)"
                  :showTokens="false"
                  @update:modelValue="onColorChange(token, $event)"
                />
              </div>
              <input
                class="token-value-input color-hex"
                :value="getEffectiveValue(token, editedColors)"
                @change="onColorChange(token, ($event.target as HTMLInputElement).value)"
              />
              <span v-if="!token.cssVar" class="no-preview-badge" title="No CSS variable — preview unavailable">no preview</span>
            </div>
          </div>
          <!-- New color tokens -->
          <div v-for="(token, i) in newColors" :key="'new-'+i" class="token-row new">
            <div class="token-info">
              <span class="token-role new-badge">+ {{ token.role }}</span>
            </div>
            <div class="token-controls">
              <div class="color-swatch-inline" :style="{ background: newTokenDisplayValue(token) }" />
              <code class="token-value-ro">{{ newTokenDisplayValue(token) }}</code>
              <button class="token-remove" @click="removeNew(newColors, i)">&times;</button>
            </div>
          </div>
          <ThemeAddTokenForm
            :active="addingNew === 'colors'"
            role-placeholder="Role (e.g. info)"
            value-placeholder="Value (e.g. #3b82f6)"
            css-var-placeholder="CSS var (optional, e.g. --color-info)"
            @add="confirmAdd"
            @cancel="cancelAdd"
          />
          <button v-if="addingNew !== 'colors'" class="add-token-btn" @click="startAdd('colors')">+ Add Color</button>
        </div>

        <!-- TYPOGRAPHY -->
        <div v-if="activeSection === 'typography'" class="theme-section">
          <h4 class="section-subtitle">Font Families</h4>
          <div v-if="families.length === 0 && newFamilies.length === 0" class="theme-section-empty">No font families detected</div>
          <div v-for="token in families" :key="token.role" class="token-row">
            <div class="token-info">
              <span class="token-role" :class="{ edited: isEdited(token, editedFamilies) }">{{ token.role }}</span>
              <code class="token-source">{{ token.source }}</code>
            </div>
            <div class="token-controls">
              <input
                class="token-value-input wide"
                :value="getEffectiveValue(token, editedFamilies)"
                @change="onTokenChange(token, ($event.target as HTMLInputElement).value, editedFamilies)"
              />
            </div>
          </div>
          <div v-for="(token, i) in newFamilies" :key="'new-'+i" class="token-row new">
            <div class="token-info"><span class="token-role new-badge">+ {{ token.role }}</span></div>
            <div class="token-controls">
              <code class="token-value-ro">{{ newTokenDisplayValue(token) }}</code>
              <button class="token-remove" @click="removeNew(newFamilies, i)">&times;</button>
            </div>
          </div>
          <ThemeAddTokenForm
            :active="addingNew === 'families'"
            role-placeholder="Role (e.g. display)"
            value-placeholder="Value (e.g. Poppins, sans-serif)"
            @add="confirmAdd"
            @cancel="cancelAdd"
          />
          <button v-if="addingNew !== 'families'" class="add-token-btn" @click="startAdd('families')">+ Add Family</button>

          <h4 class="section-subtitle" style="margin-top: 16px">Font Scale</h4>
          <div v-if="scale.length === 0 && newScale.length === 0" class="theme-section-empty">No font sizes detected</div>
          <div v-for="token in scale" :key="token.role" class="token-row">
            <div class="token-info">
              <span class="token-role" :class="{ edited: isEdited(token, editedScale) }">{{ token.role }}</span>
              <code class="token-source">{{ token.source }}</code>
            </div>
            <div class="token-controls">
              <input
                class="token-value-input"
                :value="getEffectiveValue(token, editedScale)"
                @change="onTokenChange(token, ($event.target as HTMLInputElement).value, editedScale)"
              />
              <div class="font-size-preview" :style="{ fontSize: getEffectiveValue(token, editedScale) }">Aa</div>
            </div>
          </div>
          <div v-for="(token, i) in newScale" :key="'new-'+i" class="token-row new">
            <div class="token-info"><span class="token-role new-badge">+ {{ token.role }}</span></div>
            <div class="token-controls">
              <code class="token-value-ro">{{ newTokenDisplayValue(token) }}</code>
              <button class="token-remove" @click="removeNew(newScale, i)">&times;</button>
            </div>
          </div>
          <ThemeAddTokenForm
            :active="addingNew === 'scale'"
            role-placeholder="Role (e.g. 2xl)"
            value-placeholder="Value (e.g. 1.5rem)"
            @add="confirmAdd"
            @cancel="cancelAdd"
          />
          <button v-if="addingNew !== 'scale'" class="add-token-btn" @click="startAdd('scale')">+ Add Size</button>

          <h4 v-if="weights.length" class="section-subtitle" style="margin-top: 16px">Weights</h4>
          <div v-if="weights.length" class="weight-chips">
            <span v-for="w in weights" :key="w" class="weight-chip">{{ w }}</span>
          </div>
        </div>

        <!-- SPACING -->
        <div v-if="activeSection === 'spacing'" class="theme-section">
          <div v-if="spacing.length === 0 && newSpacing.length === 0" class="theme-section-empty">No spacing tokens detected</div>
          <div v-for="token in spacing" :key="token.role" class="token-row">
            <div class="token-info">
              <span class="token-role" :class="{ edited: isEdited(token, editedSpacing) }">{{ token.role }}</span>
              <code class="token-source">{{ token.source }}</code>
            </div>
            <div class="token-controls">
              <input
                class="token-value-input"
                :value="getEffectiveValue(token, editedSpacing)"
                @change="onTokenChange(token, ($event.target as HTMLInputElement).value, editedSpacing)"
              />
              <div class="spacing-preview">
                <div class="spacing-bar" :style="{ width: getEffectiveValue(token, editedSpacing) }" />
              </div>
            </div>
          </div>
          <div v-for="(token, i) in newSpacing" :key="'new-'+i" class="token-row new">
            <div class="token-info"><span class="token-role new-badge">+ {{ token.role }}</span></div>
            <div class="token-controls">
              <code class="token-value-ro">{{ newTokenDisplayValue(token) }}</code>
              <button class="token-remove" @click="removeNew(newSpacing, i)">&times;</button>
            </div>
          </div>
          <ThemeAddTokenForm
            :active="addingNew === 'spacing'"
            role-placeholder="Role (e.g. 2xl)"
            value-placeholder="Value (e.g. 32px)"
            @add="confirmAdd"
            @cancel="cancelAdd"
          />
          <button v-if="addingNew !== 'spacing'" class="add-token-btn" @click="startAdd('spacing')">+ Add Spacing</button>
        </div>

        <!-- BORDERS -->
        <div v-if="activeSection === 'borders'" class="theme-section">
          <h4 class="section-subtitle">Border Radius</h4>
          <div v-if="radius.length === 0 && newRadius.length === 0" class="theme-section-empty">No border radius tokens detected</div>
          <div v-for="token in radius" :key="token.role" class="token-row">
            <div class="token-info">
              <span class="token-role" :class="{ edited: isEdited(token, editedRadius) }">{{ token.role }}</span>
              <code class="token-source">{{ token.source }}</code>
            </div>
            <div class="token-controls">
              <input
                class="token-value-input"
                :value="getEffectiveValue(token, editedRadius)"
                @change="onTokenChange(token, ($event.target as HTMLInputElement).value, editedRadius)"
              />
              <div class="radius-preview" :style="{ borderRadius: getEffectiveValue(token, editedRadius) }" />
            </div>
          </div>
          <div v-for="(token, i) in newRadius" :key="'new-'+i" class="token-row new">
            <div class="token-info"><span class="token-role new-badge">+ {{ token.role }}</span></div>
            <div class="token-controls">
              <code class="token-value-ro">{{ newTokenDisplayValue(token) }}</code>
              <button class="token-remove" @click="removeNew(newRadius, i)">&times;</button>
            </div>
          </div>
          <ThemeAddTokenForm
            :active="addingNew === 'radius'"
            role-placeholder="Role (e.g. xl)"
            value-placeholder="Value (e.g. 16px)"
            @add="confirmAdd"
            @cancel="cancelAdd"
          />
          <button v-if="addingNew !== 'radius'" class="add-token-btn" @click="startAdd('radius')">+ Add Radius</button>
        </div>

        <!-- LIBRARIES -->
        <ThemeLibrariesTab v-if="activeSection === 'libraries'" :design-spec="designSpec ?? null" />

      </div>
    </template>
  </div>
</template>

<style scoped>
.theme-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.theme-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.theme-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.theme-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.theme-change-count {
  font-size: 11px;
  color: var(--text-muted);
}
.theme-btn {
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  border: none;
  border-radius: 5px;
  cursor: pointer;
}
.theme-btn.commit {
  background: var(--accent);
  color: white;
}
.theme-btn.commit:hover { opacity: 0.9; }
.theme-btn.commit:disabled { opacity: 0.4; cursor: not-allowed; }
.theme-btn.discard {
  background: var(--surface-2);
  color: var(--text-muted);
  border: 1px solid var(--border);
}
.theme-btn.discard:hover { color: var(--text); background: var(--border); }
.theme-btn.small { padding: 3px 10px; font-size: 10px; }

/* Empty state */
.theme-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  text-align: center;
  padding: 24px;
}
.theme-empty p { font-size: 13px; }
.theme-empty-hint { font-size: 11px; opacity: 0.7; }
.theme-empty code {
  background: rgba(59,130,246,0.15);
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
  color: #60a5fa;
}

/* Variant bar — shown only when the spec has multiple theme variants */
.variant-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  flex-shrink: 0;
}
.variant-tabs {
  display: flex;
  flex: 1;
  gap: 4px;
  overflow-x: auto;
}
.variant-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 500;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.variant-tab:hover { color: var(--text); }
.variant-tab.active {
  color: var(--text);
  background: var(--surface-elevated);
  border-color: var(--accent);
}
.variant-tab.pinned {
  border-style: dashed;
}
.variant-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
  flex-shrink: 0;
}
.variant-follow-btn {
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 500;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.variant-follow-btn:hover { color: var(--text); background: var(--surface-elevated); }
.variant-hint {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  border-bottom: 1px solid var(--border);
}
.variant-hint strong { font-weight: 600; }

/* Tabs */
.theme-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.theme-tab {
  flex: 1;
  padding: 8px 4px;
  font-size: 11px;
  font-weight: 500;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.theme-tab:hover { color: var(--text); }
.theme-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.theme-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  font-size: 9px;
  font-weight: 700;
  background: var(--danger);
  color: white;
  border-radius: 7px;
  margin-left: 3px;
}

/* Content */
.theme-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.theme-section { display: flex; flex-direction: column; gap: 2px; }
.theme-section-empty {
  padding: 16px 0;
  text-align: center;
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.6;
}
.section-subtitle {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  padding: 6px 0 4px;
}

/* Token rows */
.token-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 6px;
  gap: 8px;
  transition: background 0.1s;
}
.token-row:hover { background: var(--surface-2); }
.token-row.new { background: rgba(59,130,246,0.06); }

.token-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex-shrink: 1;
}
.token-role {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
}
.token-role.edited { color: var(--accent); }
.token-role.new-badge { color: #22c55e; font-weight: 600; }
.token-source {
  font-size: 9px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}

.token-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.token-value-input {
  width: 80px;
  padding: 3px 6px;
  font-size: 11px;
  font-family: monospace;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  outline: none;
}
.token-value-input:focus { border-color: var(--accent); }
.token-value-input.wide { width: 160px; }
.token-value-input.color-hex { width: 72px; }

.token-value-ro {
  font-size: 11px;
  color: var(--text-muted);
}

.token-remove {
  width: 18px;
  height: 18px;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
}
.token-remove:hover { color: #ef4444; background: rgba(239,68,68,0.1); }

.no-preview-badge {
  font-size: 8px;
  color: var(--text-muted);
  opacity: 0.6;
  white-space: nowrap;
}

/* Color specific */
.color-swatch-wrapper { flex-shrink: 0; }
.color-swatch-inline {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid var(--border);
  flex-shrink: 0;
}

/* Typography previews */
.font-size-preview {
  color: var(--text);
  line-height: 1;
  white-space: nowrap;
}

.weight-chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0; }
.weight-chip {
  font-size: 10px;
  padding: 2px 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-muted);
}

/* Spacing preview */
.spacing-preview {
  width: 60px;
  height: 12px;
  background: var(--surface-2);
  border-radius: 2px;
  overflow: hidden;
}
.spacing-bar {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  max-width: 100%;
  transition: width 0.15s;
}

/* Radius preview */
.radius-preview {
  width: 24px;
  height: 24px;
  background: var(--accent);
  transition: border-radius 0.15s;
}

/* Add token form */
.add-token-btn {
  padding: 6px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-muted);
  background: none;
  border: 1px dashed var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
}
.add-token-btn:hover { color: var(--accent); border-color: var(--accent); }

.add-token-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  margin-top: 4px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.add-input {
  padding: 4px 8px;
  font-size: 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  outline: none;
  font-family: inherit;
}
.add-input:focus { border-color: var(--accent); }
.add-actions {
  display: flex;
  gap: 4px;
  margin-top: 2px;
}

/* Library cards */
.library-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.library-name { font-size: 12px; font-weight: 600; color: var(--text); }
.library-version { font-size: 10px; color: var(--text-muted); }
.styling-chip {
  font-size: 9px;
  padding: 1px 6px;
  background: rgba(59,130,246,0.12);
  color: #60a5fa;
  border-radius: 3px;
  font-weight: 600;
}

.library-components {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 0;
}
.component-chip {
  font-size: 10px;
  padding: 2px 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-muted);
  font-family: monospace;
}
</style>
