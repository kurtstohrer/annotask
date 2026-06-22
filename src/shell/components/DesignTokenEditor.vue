<script setup lang="ts">
/**
 * Reusable design-token editor.
 *
 * Used in two contexts:
 *   1. ThemePage.vue — spec comes from useDesignSpec(), edits produce
 *      commit tasks via the parent's collectEdits() / commitChanges().
 *   2. InitWizard.vue — spec comes from the init draft, edits are
 *      immediately written back via `update:spec` so they serialize on
 *      Save. No commit/discard bar needed (the wizard's Save button does it).
 *
 * The component owns the variant-selection state and the in-flight edit
 * maps. If a parent wants to read collected edits (ThemePage), it calls
 * the `collectEdits()` exposed method. If a parent just wants the mutated
 * spec object (InitWizard), it listens to `update:spec`.
 */

import { ref, computed, watch, defineExpose, type MaybeRef, toRef } from 'vue'
import type { DesignSpecToken, DesignSpecTheme, DesignSpecThemeSelector } from '../../schema'
import ColorPalettePicker from './ColorPalettePicker.vue'
import ThemeAddTokenForm from './ThemeAddTokenForm.vue'

const props = withDefaults(defineProps<{
  /** The spec to display. Pass `null` to show the empty/loading state. */
  spec: Record<string, any> | null
  /**
   * When true, the variant bar drives only local UI state — clicking a
   * variant tab doesn't attempt to activate it in an iframe. Set to true
   * in the init wizard; leave false (default) in ThemePage where the
   * parent passes `onActivateVariant`.
   */
  localOnly?: boolean
  /** Called when the user clicks a variant tab (ThemePage passes this to
   *  drive the iframe; init wizard omits it). */
  onActivateVariant?: (selector: DesignSpecThemeSelector | null | undefined, all?: DesignSpecThemeSelector[]) => Promise<void>
}>(), { localOnly: false })

const emit = defineEmits<{
  /** Emitted on every token edit — carries the mutated spec so the parent
   *  (e.g. init wizard) can persist it. ThemePage listens too but derives
   *  tasks from collectEdits() instead. */
  (e: 'update:spec', spec: Record<string, any>): void
}>()

const activeSection = ref<'colors' | 'typography' | 'spacing' | 'borders'>('colors')

// ── Theme variants ────────────────────────────────────────
const FALLBACK_THEME: DesignSpecTheme = { id: 'default', name: 'Default', selector: { kind: 'default' } }

const themes = computed<DesignSpecTheme[]>(() => {
  const list = props.spec?.themes
  return Array.isArray(list) && list.length > 0 ? list : [FALLBACK_THEME]
})

const defaultThemeId = computed(() => props.spec?.defaultTheme || themes.value[0]?.id || 'default')
const pinnedThemeId  = ref<string | null>(null)
const activeThemeId  = computed(() => pinnedThemeId.value ?? defaultThemeId.value)
const activeTheme    = computed<DesignSpecTheme>(() => themes.value.find(t => t.id === activeThemeId.value) ?? themes.value[0])

watch(() => props.spec, () => { pinnedThemeId.value = null })

function setActiveTheme(id: string) {
  const target = themes.value.find(t => t.id === id)
  if (!target) return
  if (!props.localOnly && props.onActivateVariant) {
    pinnedThemeId.value = null
    void props.onActivateVariant(target.selector, themes.value.map(t => t.selector))
    return
  }
  pinnedThemeId.value = id === defaultThemeId.value ? null : id
}

// ── Token lists ───────────────────────────────────────────
const colors   = computed(() => (props.spec?.colors ?? []) as DesignSpecToken[])
const families = computed(() => (props.spec?.typography?.families ?? []) as DesignSpecToken[])
const scale    = computed(() => (props.spec?.typography?.scale ?? []) as DesignSpecToken[])
const weights  = computed(() => (props.spec?.typography?.weights ?? []) as string[])
const spacing  = computed(() => (props.spec?.spacing ?? []) as DesignSpecToken[])
const radius   = computed(() => (props.spec?.borders?.radius ?? []) as DesignSpecToken[])

// ── Edit maps ─────────────────────────────────────────────
function editKey(themeId: string, role: string) { return `${themeId}::${role}` }

const editedColors   = ref(new Map<string, string>())
const editedFamilies = ref(new Map<string, string>())
const editedScale    = ref(new Map<string, string>())
const editedSpacing  = ref(new Map<string, string>())
const editedRadius   = ref(new Map<string, string>())

const newColors   = ref<DesignSpecToken[]>([])
const newFamilies = ref<DesignSpecToken[]>([])
const newScale    = ref<DesignSpecToken[]>([])
const newSpacing  = ref<DesignSpecToken[]>([])
const newRadius   = ref<DesignSpecToken[]>([])

const addingNew = ref<string | null>(null)

// ── Value helpers ─────────────────────────────────────────
function originalValue(token: DesignSpecToken): string {
  const values = token.values || {}
  const v = values[activeThemeId.value] ?? values[defaultThemeId.value]
  if (v !== undefined) return v
  // Handle old single-value shape
  if (typeof (token as any).value === 'string') return (token as any).value
  return Object.values(values)[0] ?? ''
}

function getEffectiveValue(token: DesignSpecToken, editMap: MaybeRef<Map<string, string>>): string {
  return toRef(editMap).value.get(editKey(activeThemeId.value, token.role)) ?? originalValue(token)
}

function isEdited(token: DesignSpecToken, editMap: MaybeRef<Map<string, string>>): boolean {
  const edited = toRef(editMap).value.get(editKey(activeThemeId.value, token.role))
  return edited !== undefined && edited !== originalValue(token)
}

function newTokenDisplayValue(token: DesignSpecToken): string {
  return token.values?.[activeThemeId.value] ?? Object.values(token.values ?? {})[0] ?? ''
}

// ── Edit handlers ─────────────────────────────────────────
function emitUpdate() {
  if (!props.spec) return
  // Bake edits into a mutated copy of the spec for the parent.
  function bake(tokens: DesignSpecToken[], editMap: Map<string, string>): DesignSpecToken[] {
    return tokens.map(tok => {
      const updated: Record<string, string> = { ...(tok.values ?? {}) }
      for (const [k, v] of editMap) {
        const [themeId, role] = k.split('::')
        if (role === tok.role) updated[themeId] = v
      }
      return { ...tok, values: updated }
    })
  }
  const updatedSpec = {
    ...props.spec,
    colors: [...bake(colors.value, editedColors.value), ...newColors.value],
    typography: {
      ...props.spec.typography,
      families: [...bake(families.value, editedFamilies.value), ...newFamilies.value],
      scale:    [...bake(scale.value, editedScale.value), ...newScale.value],
      weights:  weights.value,
    },
    spacing: [...bake(spacing.value, editedSpacing.value), ...newSpacing.value],
    borders: {
      ...props.spec.borders,
      radius: [...bake(radius.value, editedRadius.value), ...newRadius.value],
    },
  }
  emit('update:spec', updatedSpec)
}

function onColorChange(token: DesignSpecToken, value: string) {
  editedColors.value.set(editKey(activeThemeId.value, token.role), value)
  editedColors.value = new Map(editedColors.value)
  emitUpdate()
}

function onTokenChange(token: DesignSpecToken, value: string, editMap: MaybeRef<Map<string, string>>) {
  const r = toRef(editMap)
  r.value.set(editKey(activeThemeId.value, token.role), value)
  r.value = new Map(r.value)
  emitUpdate()
}

// ── Add/remove new tokens ─────────────────────────────────
function startAdd(section: string) { addingNew.value = section }
function cancelAdd() { addingNew.value = null }

function confirmAdd(payload: { role: string; value: string; cssVar?: string }) {
  const token: DesignSpecToken = {
    role: payload.role,
    values: { [activeThemeId.value]: payload.value },
    cssVar: payload.cssVar,
    source: 'new',
  }
  switch (addingNew.value) {
    case 'colors':   newColors.value   = [...newColors.value, token];   break
    case 'families': newFamilies.value = [...newFamilies.value, token]; break
    case 'scale':    newScale.value    = [...newScale.value, token];    break
    case 'spacing':  newSpacing.value  = [...newSpacing.value, token];  break
    case 'radius':   newRadius.value   = [...newRadius.value, token];   break
  }
  addingNew.value = null
  emitUpdate()
}

function removeNew(list: MaybeRef<DesignSpecToken[]>, index: number) {
  toRef(list).value = toRef(list).value.filter((_, i) => i !== index)
  emitUpdate()
}

// ── Edit counts (used by ThemePage for the commit bar) ────
function countEditsForSection(editMap: Map<string, string>, tokens: DesignSpecToken[]): number {
  let n = 0
  for (const t of tokens) for (const tid of Object.keys(t.values || {}))
    if (editMap.has(editKey(tid, t.role))) n++
  return n
}

const colorEditCount   = computed(() => countEditsForSection(editedColors.value, colors.value))
const familyEditCount  = computed(() => countEditsForSection(editedFamilies.value, families.value))
const scaleEditCount   = computed(() => countEditsForSection(editedScale.value, scale.value))
const spacingEditCount = computed(() => countEditsForSection(editedSpacing.value, spacing.value))
const radiusEditCount  = computed(() => countEditsForSection(editedRadius.value, radius.value))

const totalChanges = computed(() =>
  colorEditCount.value + familyEditCount.value + scaleEditCount.value +
  spacingEditCount.value + radiusEditCount.value +
  newColors.value.length + newFamilies.value.length + newScale.value.length +
  newSpacing.value.length + newRadius.value.length
)

// ── Exposed for ThemePage ─────────────────────────────────
interface ThemeEdit {
  category: string; role: string; cssVar: string | null; theme_variant: string
  theme_selector: DesignSpecTheme['selector'] | null; before: string | null
  after: string; sourceFile: string | null; sourceLine: number | null; isNew: boolean
}

function collectEdits(): ThemeEdit[] {
  const edits: ThemeEdit[] = []
  function pushEditsFor(cat: string, tok: DesignSpecToken, map: Map<string, string>) {
    for (const themeId of Object.keys(tok.values || {})) {
      const after = map.get(editKey(themeId, tok.role))
      const before = tok.values[themeId]
      if (after === undefined || after === before) continue
      edits.push({ category: cat, role: tok.role, cssVar: tok.cssVar || null,
        theme_variant: themeId, theme_selector: themes.value.find(t => t.id === themeId)?.selector ?? null,
        before, after, sourceFile: tok.sourceFile || null, sourceLine: tok.sourceLine || null, isNew: false })
    }
  }
  function pushNewFor(cat: string, tok: DesignSpecToken) {
    for (const [themeId, value] of Object.entries(tok.values || {})) {
      edits.push({ category: cat, role: tok.role, cssVar: tok.cssVar || null,
        theme_variant: themeId, theme_selector: themes.value.find(t => t.id === themeId)?.selector ?? null,
        before: null, after: value ?? '', sourceFile: null, sourceLine: null, isNew: true })
    }
  }
  for (const t of colors.value)   pushEditsFor('colors', t, editedColors.value)
  for (const t of families.value) pushEditsFor('typography.families', t, editedFamilies.value)
  for (const t of scale.value)    pushEditsFor('typography.scale', t, editedScale.value)
  for (const t of spacing.value)  pushEditsFor('spacing', t, editedSpacing.value)
  for (const t of radius.value)   pushEditsFor('borders.radius', t, editedRadius.value)
  for (const t of newColors.value)   pushNewFor('colors', t)
  for (const t of newFamilies.value) pushNewFor('typography.families', t)
  for (const t of newScale.value)    pushNewFor('typography.scale', t)
  for (const t of newSpacing.value)  pushNewFor('spacing', t)
  for (const t of newRadius.value)   pushNewFor('borders.radius', t)
  return edits
}

function resetEdits() {
  editedColors.value = new Map(); editedFamilies.value = new Map()
  editedScale.value  = new Map(); editedSpacing.value  = new Map(); editedRadius.value = new Map()
  newColors.value = []; newFamilies.value = []; newScale.value = []
  newSpacing.value = []; newRadius.value = []
}

defineExpose({ collectEdits, resetEdits, totalChanges, activeThemeId })
</script>

<template>
  <div class="dte">
    <!-- No spec yet -->
    <div v-if="!spec" class="dte-empty">
      <p>No design spec — run the scanner first.</p>
    </div>

    <template v-else>
      <!-- Variant bar -->
      <div v-if="themes.length > 1" class="variant-bar">
        <div class="variant-tabs">
          <button
            v-for="t in themes"
            :key="t.id"
            :class="['variant-tab', { active: t.id === activeThemeId, pinned: t.id === pinnedThemeId }]"
            @click="setActiveTheme(t.id)"
          >
            <span v-if="t.id === defaultThemeId && !pinnedThemeId" class="variant-dot" />
            {{ t.name }}
          </button>
        </div>
        <button v-if="pinnedThemeId" class="variant-follow-btn" @click="pinnedThemeId = null">
          Follow default
        </button>
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
                <ColorPalettePicker :modelValue="getEffectiveValue(token, editedColors)" :showTokens="false" @update:modelValue="onColorChange(token, $event)" />
              </div>
              <input class="token-value-input color-hex" :value="getEffectiveValue(token, editedColors)" @change="onColorChange(token, ($event.target as HTMLInputElement).value)" />
              <span v-if="!token.cssVar" class="no-preview-badge">no preview</span>
            </div>
          </div>
          <div v-for="(token, i) in newColors" :key="'nc-'+i" class="token-row new">
            <div class="token-info"><span class="token-role new-badge">+ {{ token.role }}</span></div>
            <div class="token-controls">
              <div class="color-swatch-inline" :style="{ background: newTokenDisplayValue(token) }" />
              <code class="token-value-ro">{{ newTokenDisplayValue(token) }}</code>
              <button class="token-remove" @click="removeNew(newColors, i)">&times;</button>
            </div>
          </div>
          <ThemeAddTokenForm :active="addingNew === 'colors'" role-placeholder="Role (e.g. info)" value-placeholder="Value (e.g. #3b82f6)" css-var-placeholder="CSS var (optional)" @add="confirmAdd" @cancel="cancelAdd" />
          <button v-if="addingNew !== 'colors'" class="add-token-btn" @click="startAdd('colors')">+ Add Color</button>
        </div>

        <!-- TYPOGRAPHY -->
        <div v-if="activeSection === 'typography'" class="theme-section">
          <h4 class="section-subtitle">Font Families</h4>
          <div v-if="families.length === 0 && newFamilies.length === 0" class="theme-section-empty">No font families detected</div>
          <div v-for="token in families" :key="token.role" class="token-row">
            <div class="token-info"><span class="token-role" :class="{ edited: isEdited(token, editedFamilies) }">{{ token.role }}</span><code class="token-source">{{ token.source }}</code></div>
            <div class="token-controls"><input class="token-value-input wide" :value="getEffectiveValue(token, editedFamilies)" @change="onTokenChange(token, ($event.target as HTMLInputElement).value, editedFamilies)" /></div>
          </div>
          <div v-for="(token, i) in newFamilies" :key="'nf-'+i" class="token-row new">
            <div class="token-info"><span class="token-role new-badge">+ {{ token.role }}</span></div>
            <div class="token-controls"><code class="token-value-ro">{{ newTokenDisplayValue(token) }}</code><button class="token-remove" @click="removeNew(newFamilies, i)">&times;</button></div>
          </div>
          <ThemeAddTokenForm :active="addingNew === 'families'" role-placeholder="Role (e.g. display)" value-placeholder="Value (e.g. Poppins, sans-serif)" @add="confirmAdd" @cancel="cancelAdd" />
          <button v-if="addingNew !== 'families'" class="add-token-btn" @click="startAdd('families')">+ Add Family</button>

          <h4 class="section-subtitle" style="margin-top:16px">Font Scale</h4>
          <div v-if="scale.length === 0 && newScale.length === 0" class="theme-section-empty">No font sizes detected</div>
          <div v-for="token in scale" :key="token.role" class="token-row">
            <div class="token-info"><span class="token-role" :class="{ edited: isEdited(token, editedScale) }">{{ token.role }}</span><code class="token-source">{{ token.source }}</code></div>
            <div class="token-controls">
              <input class="token-value-input" :value="getEffectiveValue(token, editedScale)" @change="onTokenChange(token, ($event.target as HTMLInputElement).value, editedScale)" />
              <div class="font-size-preview" :style="{ fontSize: getEffectiveValue(token, editedScale) }">Aa</div>
            </div>
          </div>
          <div v-for="(token, i) in newScale" :key="'ns-'+i" class="token-row new">
            <div class="token-info"><span class="token-role new-badge">+ {{ token.role }}</span></div>
            <div class="token-controls"><code class="token-value-ro">{{ newTokenDisplayValue(token) }}</code><button class="token-remove" @click="removeNew(newScale, i)">&times;</button></div>
          </div>
          <ThemeAddTokenForm :active="addingNew === 'scale'" role-placeholder="Role (e.g. 2xl)" value-placeholder="Value (e.g. 1.5rem)" @add="confirmAdd" @cancel="cancelAdd" />
          <button v-if="addingNew !== 'scale'" class="add-token-btn" @click="startAdd('scale')">+ Add Size</button>

          <template v-if="weights.length">
            <h4 class="section-subtitle" style="margin-top:16px">Weights</h4>
            <div class="weight-chips"><span v-for="w in weights" :key="w" class="weight-chip">{{ w }}</span></div>
          </template>
        </div>

        <!-- SPACING -->
        <div v-if="activeSection === 'spacing'" class="theme-section">
          <div v-if="spacing.length === 0 && newSpacing.length === 0" class="theme-section-empty">No spacing tokens detected</div>
          <div v-for="token in spacing" :key="token.role" class="token-row">
            <div class="token-info"><span class="token-role" :class="{ edited: isEdited(token, editedSpacing) }">{{ token.role }}</span><code class="token-source">{{ token.source }}</code></div>
            <div class="token-controls">
              <input class="token-value-input" :value="getEffectiveValue(token, editedSpacing)" @change="onTokenChange(token, ($event.target as HTMLInputElement).value, editedSpacing)" />
              <div class="spacing-preview"><div class="spacing-bar" :style="{ width: getEffectiveValue(token, editedSpacing) }" /></div>
            </div>
          </div>
          <div v-for="(token, i) in newSpacing" :key="'nsp-'+i" class="token-row new">
            <div class="token-info"><span class="token-role new-badge">+ {{ token.role }}</span></div>
            <div class="token-controls"><code class="token-value-ro">{{ newTokenDisplayValue(token) }}</code><button class="token-remove" @click="removeNew(newSpacing, i)">&times;</button></div>
          </div>
          <ThemeAddTokenForm :active="addingNew === 'spacing'" role-placeholder="Role (e.g. 2xl)" value-placeholder="Value (e.g. 32px)" @add="confirmAdd" @cancel="cancelAdd" />
          <button v-if="addingNew !== 'spacing'" class="add-token-btn" @click="startAdd('spacing')">+ Add Spacing</button>
        </div>

        <!-- BORDERS -->
        <div v-if="activeSection === 'borders'" class="theme-section">
          <h4 class="section-subtitle">Border Radius</h4>
          <div v-if="radius.length === 0 && newRadius.length === 0" class="theme-section-empty">No border radius tokens detected</div>
          <div v-for="token in radius" :key="token.role" class="token-row">
            <div class="token-info"><span class="token-role" :class="{ edited: isEdited(token, editedRadius) }">{{ token.role }}</span><code class="token-source">{{ token.source }}</code></div>
            <div class="token-controls">
              <input class="token-value-input" :value="getEffectiveValue(token, editedRadius)" @change="onTokenChange(token, ($event.target as HTMLInputElement).value, editedRadius)" />
              <div class="radius-preview" :style="{ borderRadius: getEffectiveValue(token, editedRadius) }" />
            </div>
          </div>
          <div v-for="(token, i) in newRadius" :key="'nr-'+i" class="token-row new">
            <div class="token-info"><span class="token-role new-badge">+ {{ token.role }}</span></div>
            <div class="token-controls"><code class="token-value-ro">{{ newTokenDisplayValue(token) }}</code><button class="token-remove" @click="removeNew(newRadius, i)">&times;</button></div>
          </div>
          <ThemeAddTokenForm :active="addingNew === 'radius'" role-placeholder="Role (e.g. xl)" value-placeholder="Value (e.g. 16px)" @add="confirmAdd" @cancel="cancelAdd" />
          <button v-if="addingNew !== 'radius'" class="add-token-btn" @click="startAdd('radius')">+ Add Radius</button>
        </div>

      </div>
    </template>
  </div>
</template>

<style scoped>
.dte { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.dte-empty { padding: 24px; text-align: center; font-size: 12px; color: var(--text-muted); }

/* Variant bar — identical to ThemePage */
.variant-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-bottom: 1px solid var(--border);
  background: var(--surface-2); flex-shrink: 0;
}
.variant-tabs { display: flex; flex: 1; gap: 4px; overflow-x: auto; }
.variant-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px; font-size: 11px; font-weight: 500;
  background: transparent; border: 1px solid var(--border);
  color: var(--text-muted); border-radius: 4px; cursor: pointer;
  white-space: nowrap; transition: all 0.15s;
}
.variant-tab:hover { color: var(--text); }
.variant-tab.active { color: var(--text); background: var(--surface-elevated); border-color: var(--accent); }
.variant-tab.pinned { border-style: dashed; }
.variant-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent); flex-shrink: 0;
}
.variant-follow-btn {
  padding: 3px 8px; font-size: 10px; font-weight: 500;
  background: transparent; border: 1px solid var(--border);
  color: var(--text-muted); border-radius: 4px; cursor: pointer; white-space: nowrap;
}
.variant-follow-btn:hover { color: var(--text); background: var(--surface-elevated); }

/* Section tabs */
.theme-tabs { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.theme-tab {
  flex: 1; padding: 8px 4px; font-size: 11px; font-weight: 500;
  background: none; border: none; border-bottom: 2px solid transparent;
  color: var(--text-muted); cursor: pointer; transition: all 0.15s;
}
.theme-tab:hover { color: var(--text); }
.theme-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.theme-tab-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 14px; height: 14px; padding: 0 3px; font-size: 9px; font-weight: 700;
  background: var(--danger); color: white; border-radius: 7px; margin-left: 3px;
}

/* Content */
.theme-content { flex: 1; overflow-y: auto; padding: 12px; }
.theme-section { display: flex; flex-direction: column; gap: 2px; }
.theme-section-empty {
  padding: 16px 0; text-align: center; font-size: 11px;
  color: var(--text-muted); opacity: 0.6;
}
.section-subtitle {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--text-muted); padding: 6px 0 4px;
}

/* Token rows */
.token-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 8px; border-radius: 6px; gap: 8px; transition: background 0.1s;
}
.token-row:hover { background: var(--surface-2); }
.token-row.new { background: color-mix(in srgb, var(--accent) 6%, transparent); }
.token-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex-shrink: 1; }
.token-role { font-size: 12px; font-weight: 500; color: var(--text); white-space: nowrap; }
.token-role.edited { color: var(--accent); }
.token-role.new-badge { color: var(--success); font-weight: 600; }
.token-source { font-size: 9px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
.token-controls { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.token-value-input {
  width: 80px; padding: 3px 6px; font-size: 11px; font-family: monospace;
  background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
  color: var(--text); outline: none;
}
.token-value-input:focus { border-color: var(--accent); }
.token-value-input.wide { width: 160px; }
.token-value-input.color-hex { width: 72px; }
.token-value-ro { font-size: 11px; color: var(--text-muted); }
.token-remove {
  width: 18px; height: 18px; border: none; background: none; color: var(--text-muted);
  font-size: 14px; cursor: pointer; display: flex; align-items: center;
  justify-content: center; border-radius: 3px;
}
.token-remove:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
.no-preview-badge { font-size: 8px; color: var(--text-muted); opacity: 0.6; white-space: nowrap; }
.color-swatch-wrapper { flex-shrink: 0; }
.color-swatch-inline {
  width: 20px; height: 20px; border-radius: 4px; border: 1px solid var(--border); flex-shrink: 0;
}
.font-size-preview { color: var(--text); line-height: 1; white-space: nowrap; }
.weight-chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0; }
.weight-chip {
  font-size: 10px; padding: 2px 8px; background: var(--surface-2);
  border: 1px solid var(--border); border-radius: 4px; color: var(--text-muted);
}
.spacing-preview { width: 60px; height: 12px; background: var(--surface-2); border-radius: 2px; overflow: hidden; }
.spacing-bar { height: 100%; background: var(--accent); border-radius: 2px; max-width: 100%; transition: width 0.15s; }
.radius-preview { width: 24px; height: 24px; background: var(--accent); transition: border-radius 0.15s; }
.add-token-btn {
  padding: 6px; margin-top: 4px; font-size: 11px; color: var(--text-muted);
  background: none; border: 1px dashed var(--border); border-radius: 6px; cursor: pointer; transition: all 0.1s;
}
.add-token-btn:hover { color: var(--accent); border-color: var(--accent); }
</style>
