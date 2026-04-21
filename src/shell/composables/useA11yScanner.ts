import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import type { useIframeManager } from './useIframeManager'
import type { useTasks } from './useTasks'
import { useComponentContextCapture } from './useComponentContextCapture'
import type { AccessibilityInfo } from '../../shared/bridge-types'

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
    // Set on synthetic tab-order violations where we already know the
    // element's bridge id and can skip the selector→eid resolve step.
    eid?: string
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

  const componentContextCapture = useComponentContextCapture(iframe)

  async function createA11yTask(violation: A11yViolation) {
    const elements = violation.elements || []
    const firstWithSource = elements.find(e => e.file)
    const colorScheme = await iframe.getColorScheme()
    // Prefer a bridge walk when the user has the offending element selected;
    // otherwise fall back to a synthetic component ref from the violation's
    // source data. Either way the server fills library/category.
    const primaryEid = primarySelection.value?.eid
    const ccAsync = primaryEid ? await componentContextCapture.capture(primaryEid) : {}
    const frag = (ccAsync.component || ccAsync.rendered)
      ? ccAsync
      : componentContextCapture.fromSource(
          firstWithSource?.component,
          firstWithSource?.file,
          firstWithSource?.line,
        )

    // Resolve each violation's selector → eid, then ask the iframe for
    // computed accessibility info. Gives the agent foreground/background
    // hex + ratio for color-contrast, computed accessible name + source
    // for label/button-name fixes, and ARIA attribute audits — none of
    // which axe surfaces in `failureSummary` in a structured form.
    const selectors = elements.map(e => e.target).filter(Boolean) as string[]
    const resolved = selectors.length > 0 ? await iframe.resolveBySelectors(selectors) : []
    const eids = resolved.map(r => r.eid).filter((e): e is string => !!e)
    const accessibilityInfos = eids.length > 0 ? await iframe.computeAccessibilityInfo(eids) : []
    const a11yByEid = new Map<string, AccessibilityInfo>()
    for (let i = 0; i < eids.length; i++) {
      const info = accessibilityInfos[i]
      if (info) a11yByEid.set(eids[i], info)
    }
    const eidBySelector = new Map<string, string | null>()
    for (const r of resolved) eidBySelector.set(r.selector, r.eid)

    taskSystem.createTask({
      type: 'a11y_fix',
      description: `Fix accessibility: ${violation.help}`,
      file: firstWithSource?.file || '',
      line: firstWithSource?.line ? parseInt(firstWithSource.line) : 0,
      component: firstWithSource?.component || '',
      route: currentRoute.value,
      ...(colorScheme ? { color_scheme: colorScheme } : {}),
      context: {
        ...(frag.component ? { component: frag.component } : {}),
        ...(frag.rendered ? { rendered: frag.rendered } : {}),
        rule: violation.id,
        impact: violation.impact,
        description: violation.description,
        help: violation.help,
        helpUrl: violation.helpUrl,
        affected_elements: violation.nodes,
        elements: elements.map(e => {
          const eid = eidBySelector.get(e.target) || null
          const a11yInfo = eid ? a11yByEid.get(eid) : undefined
          return {
            html: e.html,
            selector: e.target,
            fix: e.failureSummary,
            ...(e.file ? { file: e.file, line: e.line, component: e.component } : {}),
            ...(a11yInfo ? { a11y: a11yInfo } : {}),
          }
        }),
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
