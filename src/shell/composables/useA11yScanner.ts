import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import type { useIframeManager } from './useIframeManager'
import type { useTasks } from './useTasks'

type IframeManager = ReturnType<typeof useIframeManager>
type TaskSystem = ReturnType<typeof useTasks>

export interface A11yViolation {
  id: string
  impact: string
  description: string
  help: string
  helpUrl: string
  nodes: number
  elements?: Array<{
    html: string
    target: string
    failureSummary: string
    file?: string
    line?: string
    component?: string
  }>
}

export function useA11yScanner(
  iframe: IframeManager,
  taskSystem: TaskSystem,
  primarySelection: Ref<{ eid: string; tagName: string; component: string } | null>,
  currentRoute: Ref<string>,
) {
  const a11yViolations = ref<A11yViolation[]>([])
  const a11yLoading = ref(false)
  const a11yError = ref<string | null>(null)
  const a11yScanned = ref(false)
  const a11yScanTarget = ref('')

  const a11yTaskRules = computed(() => {
    const rules = new Set<string>()
    for (const t of taskSystem.tasks.value) {
      if (t.type === 'a11y_fix' && t.context?.rule) rules.add(t.context.rule as string)
    }
    return rules
  })

  async function scanA11y(target: 'element' | 'page' = 'element') {
    a11yLoading.value = true
    a11yError.value = null
    const eid = target === 'element' ? primarySelection.value?.eid : undefined
    a11yScanTarget.value = eid
      ? `<${primarySelection.value?.tagName}> · ${primarySelection.value?.component}`
      : 'full page'
    const result = await iframe.scanA11y(eid)
    a11yViolations.value = result.violations
    a11yError.value = result.error || null
    a11yLoading.value = false
    a11yScanned.value = true
  }

  async function createA11yTask(violation: A11yViolation) {
    const elements = violation.elements || []
    const firstWithSource = elements.find(e => e.file)
    const colorScheme = await iframe.getColorScheme()
    taskSystem.createTask({
      type: 'a11y_fix',
      description: `Fix accessibility: ${violation.help}`,
      file: firstWithSource?.file || '',
      line: firstWithSource?.line ? parseInt(firstWithSource.line) : 0,
      component: firstWithSource?.component || '',
      route: currentRoute.value,
      ...(colorScheme ? { color_scheme: colorScheme } : {}),
      context: {
        rule: violation.id,
        impact: violation.impact,
        description: violation.description,
        help: violation.help,
        helpUrl: violation.helpUrl,
        affected_elements: violation.nodes,
        elements: elements.map(e => ({
          html: e.html,
          selector: e.target,
          fix: e.failureSummary,
          ...(e.file ? { file: e.file, line: e.line, component: e.component } : {}),
        })),
      },
    })
  }

  return {
    a11yViolations,
    a11yLoading,
    a11yError,
    a11yScanned,
    a11yScanTarget,
    a11yTaskRules,
    scanA11y,
    createA11yTask,
  }
}
