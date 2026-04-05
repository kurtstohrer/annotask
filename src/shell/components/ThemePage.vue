<script setup lang="ts">
import { ref, computed, type Ref, type MaybeRef, toRef } from 'vue'
import { useDesignSpec } from '../composables/useDesignSpec'
import { useThemePreview } from '../composables/useThemePreview'
import { useTasks } from '../composables/useTasks'
import type { DesignSpecToken } from '../../schema'
import ColorPalettePicker from './ColorPalettePicker.vue'

const props = defineProps<{
  iframeRef: HTMLIFrameElement | null
}>()

const { designSpec, isInitialized, isLoading } = useDesignSpec()
const themePreview = useThemePreview(
  computed(() => props.iframeRef) as Ref<HTMLIFrameElement | null>
)
const taskSystem = useTasks()

const activeSection = ref<'colors' | 'typography' | 'spacing' | 'borders' | 'libraries'>('colors')

// ── Editing state ──
// Track edits as role -> new value
const editedColors = ref<Map<string, string>>(new Map())
const editedFamilies = ref<Map<string, string>>(new Map())
const editedScale = ref<Map<string, string>>(new Map())
const editedSpacing = ref<Map<string, string>>(new Map())
const editedRadius = ref<Map<string, string>>(new Map())

// Track new tokens
const newColors = ref<DesignSpecToken[]>([])
const newFamilies = ref<DesignSpecToken[]>([])
const newScale = ref<DesignSpecToken[]>([])
const newSpacing = ref<DesignSpecToken[]>([])
const newRadius = ref<DesignSpecToken[]>([])

// Adding state
const addingNew = ref<string | null>(null)
const newRole = ref('')
const newValue = ref('')
const newCssVar = ref('')

const iframeDoc = computed(() => {
  try {
    return props.iframeRef?.contentDocument ?? null
  } catch { return null }
})

// ── Computed token lists with edits applied ──
const colors = computed(() => designSpec.value?.colors ?? [])
const families = computed(() => designSpec.value?.typography?.families ?? [])
const scale = computed(() => designSpec.value?.typography?.scale ?? [])
const weights = computed(() => designSpec.value?.typography?.weights ?? [])
const spacing = computed(() => designSpec.value?.spacing ?? [])
const radius = computed(() => designSpec.value?.borders?.radius ?? [])
const icons = computed(() => designSpec.value?.icons ?? null)
const components = computed(() => designSpec.value?.components ?? null)

const totalChanges = computed(() =>
  editedColors.value.size + editedFamilies.value.size + editedScale.value.size +
  editedSpacing.value.size + editedRadius.value.size +
  newColors.value.length + newFamilies.value.length + newScale.value.length +
  newSpacing.value.length + newRadius.value.length
)

// ── Edit handlers ──
function onColorChange(token: DesignSpecToken, value: string) {
  editedColors.value.set(token.role, value)
  editedColors.value = new Map(editedColors.value) // trigger reactivity
  if (token.cssVar) themePreview.setOverride(token.cssVar, value)
}

function onTokenChange(
  token: DesignSpecToken,
  value: string,
  editMap: MaybeRef<Map<string, string>>
) {
  const r = toRef(editMap)
  r.value.set(token.role, value)
  r.value = new Map(r.value)
  if (token.cssVar) themePreview.setOverride(token.cssVar, value)
}

function getEffectiveValue(token: DesignSpecToken, editMap: MaybeRef<Map<string, string>>): string {
  const map = toRef(editMap).value
  return map.get(token.role) ?? token.value
}

function isEdited(token: DesignSpecToken, editMap: MaybeRef<Map<string, string>>): boolean {
  const map = toRef(editMap).value
  const edited = map.get(token.role)
  return edited !== undefined && edited !== token.value
}

// ── Add new token ──
function startAdd(section: string) {
  addingNew.value = section
  newRole.value = ''
  newValue.value = ''
  newCssVar.value = ''
}

function cancelAdd() {
  addingNew.value = null
}

function confirmAdd() {
  if (!newRole.value.trim() || !newValue.value.trim()) return
  const token: DesignSpecToken = {
    role: newRole.value.trim(),
    value: newValue.value.trim(),
    cssVar: newCssVar.value.trim() || undefined,
    source: 'new',
  }
  switch (addingNew.value) {
    case 'colors': newColors.value = [...newColors.value, token]; break
    case 'families': newFamilies.value = [...newFamilies.value, token]; break
    case 'scale': newScale.value = [...newScale.value, token]; break
    case 'spacing': newSpacing.value = [...newSpacing.value, token]; break
    case 'radius': newRadius.value = [...newRadius.value, token]; break
  }
  if (token.cssVar) themePreview.setOverride(token.cssVar, token.value)
  addingNew.value = null
}

function removeNew(list: MaybeRef<DesignSpecToken[]>, index: number) {
  const r = toRef(list)
  const token = r.value[index]
  if (token.cssVar) themePreview.removeOverride(token.cssVar)
  r.value = r.value.filter((_, i) => i !== index)
}

// ── Commit ──
function buildTasks() {
  const tasks: Record<string, unknown>[] = []
  const styling = designSpec.value?.framework?.styling ?? []

  function addEditTask(
    category: string,
    token: DesignSpecToken,
    editMap: Map<string, string>
  ) {
    const newVal = editMap.get(token.role)
    if (!newVal || newVal === token.value) return
    tasks.push({
      type: 'theme_update',
      description: `Update ${category} "${token.role}" from ${token.value} to ${newVal}`,
      file: token.sourceFile || '',
      line: token.sourceLine || 0,
      intent: `Change the ${token.role} ${category} token to ${newVal} across the application`,
      action: 'theme_update',
      context: {
        category,
        role: token.role,
        before: token.value,
        after: newVal,
        cssVar: token.cssVar || null,
        source: token.source,
        sourceFile: token.sourceFile || null,
        sourceLine: token.sourceLine || null,
        styling,
      },
    })
  }

  function addNewTask(category: string, token: DesignSpecToken) {
    tasks.push({
      type: 'theme_update',
      description: `Add new ${category} token "${token.role}" with value ${token.value}`,
      file: '',
      line: 0,
      intent: `Add a new ${token.role} ${category} token with value ${token.value} to the design system`,
      action: 'theme_update',
      context: {
        category,
        role: token.role,
        before: null,
        after: token.value,
        cssVar: token.cssVar || null,
        source: null,
        sourceFile: null,
        sourceLine: null,
        styling,
        isNew: true,
      },
    })
  }

  // Edited tokens
  for (const token of colors.value) addEditTask('colors', token, editedColors.value)
  for (const token of families.value) addEditTask('typography.families', token, editedFamilies.value)
  for (const token of scale.value) addEditTask('typography.scale', token, editedScale.value)
  for (const token of spacing.value) addEditTask('spacing', token, editedSpacing.value)
  for (const token of radius.value) addEditTask('borders.radius', token, editedRadius.value)

  // New tokens
  for (const token of newColors.value) addNewTask('colors', token)
  for (const token of newFamilies.value) addNewTask('typography.families', token)
  for (const token of newScale.value) addNewTask('typography.scale', token)
  for (const token of newSpacing.value) addNewTask('spacing', token)
  for (const token of newRadius.value) addNewTask('borders.radius', token)

  return tasks
}

async function commitChanges() {
  const tasks = buildTasks()
  for (const task of tasks) {
    await taskSystem.createTask(task)
  }
  // Clear all edits
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
  themePreview.clearAll()
}

function discardChanges() {
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
  themePreview.clearAll()
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
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4l2 2"/>
      </svg>
      <p>No design spec found</p>
      <p class="theme-empty-hint">Run <code>/annotask-init</code> in your AI assistant to scan your project's design system</p>
    </div>

    <template v-else>
      <!-- Section tabs -->
      <div class="theme-tabs">
        <button :class="['theme-tab', { active: activeSection === 'colors' }]" @click="activeSection = 'colors'">
          Colors <span v-if="editedColors.size + newColors.length" class="theme-tab-badge">{{ editedColors.size + newColors.length }}</span>
        </button>
        <button :class="['theme-tab', { active: activeSection === 'typography' }]" @click="activeSection = 'typography'">
          Type <span v-if="editedFamilies.size + editedScale.size + newFamilies.length + newScale.length" class="theme-tab-badge">{{ editedFamilies.size + editedScale.size + newFamilies.length + newScale.length }}</span>
        </button>
        <button :class="['theme-tab', { active: activeSection === 'spacing' }]" @click="activeSection = 'spacing'">
          Spacing <span v-if="editedSpacing.size + newSpacing.length" class="theme-tab-badge">{{ editedSpacing.size + newSpacing.length }}</span>
        </button>
        <button :class="['theme-tab', { active: activeSection === 'borders' }]" @click="activeSection = 'borders'">
          Borders <span v-if="editedRadius.size + newRadius.length" class="theme-tab-badge">{{ editedRadius.size + newRadius.length }}</span>
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
                  :iframeDoc="iframeDoc"
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
              <div class="color-swatch-inline" :style="{ background: token.value }" />
              <code class="token-value-ro">{{ token.value }}</code>
              <button class="token-remove" @click="removeNew(newColors, i)">&times;</button>
            </div>
          </div>
          <!-- Add new form -->
          <div v-if="addingNew === 'colors'" class="add-token-form">
            <input v-model="newRole" class="add-input" placeholder="Role (e.g. info)" />
            <input v-model="newValue" class="add-input" placeholder="Value (e.g. #3b82f6)" />
            <input v-model="newCssVar" class="add-input" placeholder="CSS var (optional, e.g. --color-info)" />
            <div class="add-actions">
              <button class="theme-btn commit small" @click="confirmAdd" :disabled="!newRole.trim() || !newValue.trim()">Add</button>
              <button class="theme-btn discard small" @click="cancelAdd">Cancel</button>
            </div>
          </div>
          <button v-else class="add-token-btn" @click="startAdd('colors')">+ Add Color</button>
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
              <code class="token-value-ro">{{ token.value }}</code>
              <button class="token-remove" @click="removeNew(newFamilies, i)">&times;</button>
            </div>
          </div>
          <div v-if="addingNew === 'families'" class="add-token-form">
            <input v-model="newRole" class="add-input" placeholder="Role (e.g. display)" />
            <input v-model="newValue" class="add-input" placeholder="Value (e.g. Poppins, sans-serif)" />
            <input v-model="newCssVar" class="add-input" placeholder="CSS var (optional)" />
            <div class="add-actions">
              <button class="theme-btn commit small" @click="confirmAdd" :disabled="!newRole.trim() || !newValue.trim()">Add</button>
              <button class="theme-btn discard small" @click="cancelAdd">Cancel</button>
            </div>
          </div>
          <button v-else class="add-token-btn" @click="startAdd('families')">+ Add Family</button>

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
              <code class="token-value-ro">{{ token.value }}</code>
              <button class="token-remove" @click="removeNew(newScale, i)">&times;</button>
            </div>
          </div>
          <div v-if="addingNew === 'scale'" class="add-token-form">
            <input v-model="newRole" class="add-input" placeholder="Role (e.g. 2xl)" />
            <input v-model="newValue" class="add-input" placeholder="Value (e.g. 1.5rem)" />
            <input v-model="newCssVar" class="add-input" placeholder="CSS var (optional)" />
            <div class="add-actions">
              <button class="theme-btn commit small" @click="confirmAdd" :disabled="!newRole.trim() || !newValue.trim()">Add</button>
              <button class="theme-btn discard small" @click="cancelAdd">Cancel</button>
            </div>
          </div>
          <button v-else class="add-token-btn" @click="startAdd('scale')">+ Add Size</button>

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
              <code class="token-value-ro">{{ token.value }}</code>
              <button class="token-remove" @click="removeNew(newSpacing, i)">&times;</button>
            </div>
          </div>
          <div v-if="addingNew === 'spacing'" class="add-token-form">
            <input v-model="newRole" class="add-input" placeholder="Role (e.g. 2xl)" />
            <input v-model="newValue" class="add-input" placeholder="Value (e.g. 32px)" />
            <input v-model="newCssVar" class="add-input" placeholder="CSS var (optional)" />
            <div class="add-actions">
              <button class="theme-btn commit small" @click="confirmAdd" :disabled="!newRole.trim() || !newValue.trim()">Add</button>
              <button class="theme-btn discard small" @click="cancelAdd">Cancel</button>
            </div>
          </div>
          <button v-else class="add-token-btn" @click="startAdd('spacing')">+ Add Spacing</button>
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
              <code class="token-value-ro">{{ token.value }}</code>
              <button class="token-remove" @click="removeNew(newRadius, i)">&times;</button>
            </div>
          </div>
          <div v-if="addingNew === 'radius'" class="add-token-form">
            <input v-model="newRole" class="add-input" placeholder="Role (e.g. xl)" />
            <input v-model="newValue" class="add-input" placeholder="Value (e.g. 16px)" />
            <input v-model="newCssVar" class="add-input" placeholder="CSS var (optional)" />
            <div class="add-actions">
              <button class="theme-btn commit small" @click="confirmAdd" :disabled="!newRole.trim() || !newValue.trim()">Add</button>
              <button class="theme-btn discard small" @click="cancelAdd">Cancel</button>
            </div>
          </div>
          <button v-else class="add-token-btn" @click="startAdd('radius')">+ Add Radius</button>
        </div>

        <!-- LIBRARIES -->
        <div v-if="activeSection === 'libraries'" class="theme-section">
          <h4 class="section-subtitle">Icons</h4>
          <div v-if="!icons" class="theme-section-empty">No icon library detected</div>
          <div v-else class="library-card">
            <span class="library-name">{{ icons.library }}</span>
            <span v-if="icons.version" class="library-version">v{{ icons.version }}</span>
          </div>

          <h4 class="section-subtitle" style="margin-top: 16px">Components</h4>
          <div v-if="!components" class="theme-section-empty">No component library detected</div>
          <template v-else>
            <div class="library-card">
              <span class="library-name">{{ components.library }}</span>
              <span v-if="components.version" class="library-version">v{{ components.version }}</span>
            </div>
            <div v-if="components.used.length" class="library-components">
              <span v-for="c in components.used" :key="c" class="component-chip">{{ c }}</span>
            </div>
          </template>

          <h4 class="section-subtitle" style="margin-top: 16px">Framework</h4>
          <div v-if="designSpec?.framework" class="library-card">
            <span class="library-name">{{ designSpec.framework.name }}</span>
            <span class="library-version">v{{ designSpec.framework.version }}</span>
            <span v-for="s in designSpec.framework.styling" :key="s" class="styling-chip">{{ s }}</span>
          </div>
        </div>

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
