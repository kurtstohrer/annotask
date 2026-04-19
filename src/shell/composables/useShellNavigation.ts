import { watch, type Ref } from 'vue'
import { useLocalStorageEnum } from './useLocalStorageRef'
import type { InteractionMode } from './useInteractionMode'

export type ShellView = 'editor' | 'design' | 'develop'
export type DesignSection = 'tokens' | 'inspector' | 'components'
export type DevelopSection = 'a11y' | 'data' | 'libraries' | 'perf' | 'errors'
export type ActivePanel = 'tasks' | 'inspector'

const SHELL_VIEWS: ShellView[] = ['editor', 'design', 'develop']
const DESIGN_SECTIONS: DesignSection[] = ['tokens', 'inspector', 'components']
const DEVELOP_SECTIONS: DevelopSection[] = ['a11y', 'data', 'libraries', 'perf', 'errors']
const ACTIVE_PANELS: ActivePanel[] = ['tasks', 'inspector']

const SHELL_VIEW_KEY = 'annotask:shellView'
const DESIGN_SECTION_KEY = 'annotask:designSection'
const DEVELOP_SECTION_KEY = 'annotask:developSection'
const LEGACY_PERF_SECTION_KEY = 'annotask:perfSection'

// One-shot migration of legacy view ids and the retired perfSection key.
// Runs before the useLocalStorageEnum refs read from storage so they pick up
// the rewritten values instead of clamping an unrecognised legacy value to
// its fallback.
function migrateLegacyNavigation(): void {
  try {
    const legacyView = localStorage.getItem(SHELL_VIEW_KEY)
    const legacyPerf = localStorage.getItem(LEGACY_PERF_SECTION_KEY)
    if (!legacyView && !legacyPerf) return

    if (legacyView === 'theme') {
      localStorage.setItem(SHELL_VIEW_KEY, 'design')
      if (!localStorage.getItem(DESIGN_SECTION_KEY)) {
        localStorage.setItem(DESIGN_SECTION_KEY, 'tokens')
      }
    } else if (legacyView === 'components') {
      localStorage.setItem(SHELL_VIEW_KEY, 'design')
      localStorage.setItem(DESIGN_SECTION_KEY, 'components')
    } else if (legacyView === 'data') {
      localStorage.setItem(SHELL_VIEW_KEY, 'develop')
      localStorage.setItem(DEVELOP_SECTION_KEY, 'data')
    } else if (legacyView === 'perf') {
      localStorage.setItem(SHELL_VIEW_KEY, 'develop')
      const devSection = legacyPerf === 'errors' ? 'errors' : 'perf'
      localStorage.setItem(DEVELOP_SECTION_KEY, devSection)
    } else if (legacyView === 'a11y') {
      localStorage.setItem(SHELL_VIEW_KEY, 'develop')
      localStorage.setItem(DEVELOP_SECTION_KEY, 'a11y')
    }

    if (legacyPerf) localStorage.removeItem(LEGACY_PERF_SECTION_KEY)
  } catch {
    // localStorage unavailable — fall back to defaults via useLocalStorageEnum.
  }
}

interface UseShellNavigationOptions {
  interactionMode: Ref<InteractionMode>
}

/**
 * View routing state (shellView, designSection, developSection, activePanel)
 * plus the cross-cutting watchers that keep them in sync when the user
 * switches views.
 */
export function useShellNavigation({ interactionMode }: UseShellNavigationOptions) {
  migrateLegacyNavigation()

  const shellView = useLocalStorageEnum<ShellView>(SHELL_VIEW_KEY, SHELL_VIEWS, 'editor')
  const designSection = useLocalStorageEnum<DesignSection>(DESIGN_SECTION_KEY, DESIGN_SECTIONS, 'tokens')
  const developSection = useLocalStorageEnum<DevelopSection>(DEVELOP_SECTION_KEY, DEVELOP_SECTIONS, 'a11y')
  const activePanel = useLocalStorageEnum<ActivePanel>('annotask:activePanel', ACTIVE_PANELS, 'tasks')

  let savedAnnotateMode: InteractionMode | null = null

  function modeForView(view: ShellView): InteractionMode {
    // Design view wants select mode across all sub-sections (tokens, inspector,
    // and components all rely on element selection). Everything else uses
    // interact so the underlying app stays fully usable.
    return view === 'design' ? 'select' : 'interact'
  }

  // Switching shellView: save/restore interaction mode appropriately.
  watch(shellView, (v, old) => {
    const wasEditor = old === 'editor'
    const isEditor = v === 'editor'
    if (!isEditor && wasEditor) {
      savedAnnotateMode = interactionMode.value
      interactionMode.value = modeForView(v)
    } else if (isEditor && !wasEditor && savedAnnotateMode) {
      interactionMode.value = savedAnnotateMode
      savedAnnotateMode = null
    } else if (!isEditor && !wasEditor) {
      interactionMode.value = modeForView(v)
    }
  })

  // Any sub-section of Develop (Data, Performance, Errors) or the Components
  // sub-section of Design renders its content in the main panel slot — if
  // activePanel is 'tasks', TasksPanel wins the v-else-if chain and the
  // dedicated page never shows. Nudge activePanel to 'inspector' on entry so
  // the page actually renders. Runs synchronously at init so a reload with a
  // stale 'tasks' activePanel still lands on the right surface.
  function maybeShowInspectorPanel(): void {
    const onDevelop = shellView.value === 'develop'
    const onComponents = shellView.value === 'design' && designSection.value === 'components'
    if ((onDevelop || onComponents) && activePanel.value === 'tasks') {
      activePanel.value = 'inspector'
    }
  }
  maybeShowInspectorPanel()
  watch(shellView, maybeShowInspectorPanel)
  watch(designSection, maybeShowInspectorPanel)
  watch(developSection, maybeShowInspectorPanel)

  return { shellView, designSection, developSection, activePanel }
}
