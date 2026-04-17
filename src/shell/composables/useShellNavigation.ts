import { watch, type Ref } from 'vue'
import { useLocalStorageEnum } from './useLocalStorageRef'
import type { InteractionMode } from './useInteractionMode'

export type ShellView = 'editor' | 'theme' | 'a11y' | 'perf'
export type PerfSection = 'vitals' | 'errors' | 'tasks'
export type ActivePanel = 'tasks' | 'inspector'

const SHELL_VIEWS: ShellView[] = ['editor', 'theme', 'a11y', 'perf']
const PERF_SECTIONS: PerfSection[] = ['vitals', 'errors', 'tasks']
const ACTIVE_PANELS: ActivePanel[] = ['tasks', 'inspector']

interface UseShellNavigationOptions {
  interactionMode: Ref<InteractionMode>
}

/**
 * View routing state (shellView, perfSection, activePanel) + the cross-cutting
 * watchers that keep them in sync when the user switches views.
 */
export function useShellNavigation({ interactionMode }: UseShellNavigationOptions) {
  const shellView = useLocalStorageEnum<ShellView>('annotask:shellView', SHELL_VIEWS, 'editor')
  const perfSection = useLocalStorageEnum<PerfSection>('annotask:perfSection', PERF_SECTIONS, 'vitals')
  const activePanel = useLocalStorageEnum<ActivePanel>('annotask:activePanel', ACTIVE_PANELS, 'tasks')

  let savedAnnotateMode: InteractionMode | null = null

  // Switching shellView: save/restore interaction mode appropriately
  watch(shellView, (v, old) => {
    const wasEditor = old === 'editor'
    const isEditor = v === 'editor'
    if (!isEditor && wasEditor) {
      // Leaving editor — save mode, switch to interact (or select for theme)
      savedAnnotateMode = interactionMode.value
      interactionMode.value = v === 'theme' ? 'select' : 'interact'
    } else if (isEditor && !wasEditor && savedAnnotateMode) {
      // Returning to editor — restore saved mode
      interactionMode.value = savedAnnotateMode
      savedAnnotateMode = null
    } else if (!isEditor && !wasEditor) {
      // Switching between non-editor views
      interactionMode.value = v === 'theme' ? 'select' : 'interact'
    }
  })

  // Keep activePanel ↔ perfSection in sync when in perf view
  watch(activePanel, (v) => {
    if (shellView.value === 'perf' && v !== 'tasks' && perfSection.value === 'tasks') {
      perfSection.value = 'vitals'
    }
  })

  watch(perfSection, (v) => {
    if (shellView.value !== 'perf') return
    if (v === 'tasks') {
      activePanel.value = 'tasks'
    } else if (activePanel.value === 'tasks') {
      activePanel.value = 'inspector'
    }
  })

  return { shellView, perfSection, activePanel }
}
