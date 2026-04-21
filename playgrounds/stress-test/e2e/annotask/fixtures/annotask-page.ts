import type { Page, FrameLocator } from '@playwright/test'
import { expect } from '@playwright/test'
import { SEL } from '../helpers/selectors'
import { shellUrl, type AppTarget } from './apps'

export class AnnotaskShell {
  constructor(public readonly page: Page, public readonly app: AppTarget) {}

  get iframe(): FrameLocator {
    return this.page.frameLocator(SEL.iframe)
  }

  async open(): Promise<void> {
    await this.page.goto(shellUrl(this.app))
    await expect(this.page.locator(SEL.shellToolbar)).toBeVisible({ timeout: 20_000 })
    await expect(this.page.locator(SEL.iframe)).toBeVisible({ timeout: 20_000 })
  }

  async gotoTab(tab: 'annotate' | 'design' | 'audit'): Promise<void> {
    const sel = tab === 'annotate' ? SEL.tabAnnotate : tab === 'design' ? SEL.tabDesign : SEL.tabAudit
    await this.page.locator(sel).click()
  }

  async activateTool(tool: 'pin' | 'arrow' | 'draw' | 'highlight' | 'select' | 'interact'): Promise<void> {
    await this.gotoTab('annotate')
    const map = {
      pin: SEL.toolPin,
      arrow: SEL.toolArrow,
      draw: SEL.toolDraw,
      highlight: SEL.toolHighlight,
      select: SEL.toolSelect,
      interact: SEL.toolInteract,
    } as const
    await this.page.locator(map[tool]).click()
  }

  async openTasksPanel(): Promise<void> {
    const panel = this.page.locator(SEL.tasksPanel)
    if (await panel.isVisible().catch(() => false)) return
    await this.page.locator(SEL.btnTasksPanel).first().click()
    await expect(panel).toBeVisible()
  }

  async gotoAuditSection(section: 'a11y' | 'data' | 'libraries' | 'perf' | 'errors'): Promise<void> {
    await this.gotoTab('audit')
    const map = {
      a11y: SEL.auditA11y,
      data: SEL.auditData,
      libraries: SEL.auditLibraries,
      perf: SEL.auditPerf,
      errors: SEL.auditErrors,
    } as const
    await this.page.locator(map[section]).click()
  }

  async gotoDesignSection(section: 'tokens' | 'inspector' | 'components'): Promise<void> {
    await this.gotoTab('design')
    const map = {
      tokens: SEL.designTokens,
      inspector: SEL.designInspector,
      components: SEL.designComponents,
    } as const
    await this.page.locator(map[section]).click()
  }
}
