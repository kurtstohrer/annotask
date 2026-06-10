/**
 * Annotask Init Wizard — Demo Recording Script
 *
 * Records the full init wizard flow on the marketing playground
 * using testreel for animated cursor + visual polish.
 *
 * Prerequisites:
 *   1. pnpm dev:marketing            (Marketing playground on :5181)
 *   2. Clean .annotask config (bash demo/clean-config.sh)
 *   3. `claude` CLI installed + authenticated
 *
 * Run:
 *   npx tsx demo/record-init-demo.ts
 */

import { chromium } from '@playwright/test'
import { recordPage } from 'testreel'

const BASE = 'http://localhost:5181/__annotask/'

/** Try an action; log and skip on failure so recording continues. */
async function tryAction(label: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (err: any) {
    console.warn(`  ⚠ Skipped "${label}": ${err.message?.split('\n')[0]}`)
  }
}

async function main() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
    recordVideo: {
      dir: './demo/segments/_raw',
      size: { width: 1920, height: 1080 },
    },
  })
  const page = await context.newPage()

  const recorder = await recordPage(page, {
    outputDir: './demo/segments',
    name: 'init-wizard',
    clean: true,
    cursor: {
      style: 'default',
      size: 20,
      color: '#3b82f6',
      rippleColor: 'rgba(59, 130, 246, 0.4)',
      rippleSize: 80,
    },
    outputFormat: 'webm',
  })

  // ─── Segment 1: Opening ────────────────────────────────────────────
  console.log('Segment 1: Opening')
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('.init-modal-backdrop', { timeout: 15_000 })
  await recorder.wait(1500)

  // Hover over the stepper to draw attention to the 3 steps
  await recorder.hover('.init-stepper-item:nth-child(1) .init-stepper-btn')
  await recorder.wait(500)
  await recorder.hover('.init-stepper-item:nth-child(2) .init-stepper-btn')
  await recorder.wait(500)
  await recorder.hover('.init-stepper-item:nth-child(3) .init-stepper-btn')
  await recorder.wait(1500)

  // ─── Segment 2: Pick init agent ────────────────────────────────────
  console.log('Segment 2: Pick init agent')
  await recorder.hover('.init-agent-duties')
  await recorder.wait(2000)

  const agentSelect = '.aqs .aqs-row:first-child .aqs-field:first-child select'

  // Switch to Codex
  await recorder.click(agentSelect)
  await recorder.wait(300)
  await page.selectOption(agentSelect, 'codex-local')
  await recorder.wait(1500)

  // Switch to OpenCode
  await recorder.click(agentSelect)
  await recorder.wait(300)
  await page.selectOption(agentSelect, 'opencode-local')
  await recorder.wait(1500)

  // Switch back to Claude
  await recorder.click(agentSelect)
  await recorder.wait(300)
  await page.selectOption(agentSelect, 'claude-local')
  await recorder.wait(1000)

  // Show the Mode toggle
  await recorder.hover(page.locator('.aqs-field-label', { hasText: 'Mode' }))
  await recorder.wait(800)

  // Show the Permissions row
  await recorder.hover(page.locator('.aqs-field-label', { hasText: 'Permissions' }))
  await recorder.wait(800)

  // Click "Continue →"
  console.log('  Clicking Continue →')
  await recorder.click(page.locator('.init-btn-primary', { hasText: 'Continue' }))
  await recorder.wait(1000)

  // ─── Segment 3: Scan progress ──────────────────────────────────────
  console.log('Segment 3: Scan progress')
  await page.waitForSelector('.init-progress-row', { timeout: 15_000 })
  await recorder.wait(1000)

  // Wait for the scan to finish (Claude CLI — up to 4 minutes)
  console.log('  Waiting for scan to complete...')
  const reviewBtn = page.locator('.init-btn-secondary', { hasText: 'Review' })
  await reviewBtn.waitFor({ timeout: 240_000 })
  console.log('  Scan complete')

  // Show the agent output log (if present)
  await tryAction('agent log', async () => {
    const log = await page.$('.init-agent-log')
    if (!log) return
    await recorder.hover('.init-agent-log-header')
    await recorder.wait(1000)
    await page.evaluate(() => {
      const el = document.querySelector('.init-agent-log-body')
      if (el) el.scrollTop = el.scrollHeight
    })
    await recorder.wait(1500)
  })

  // Hover over token usage (if present)
  await tryAction('token usage', async () => {
    const el = await page.$('[data-testid="init-token-usage"]')
    if (!el) return
    await recorder.hover('[data-testid="init-token-usage"]')
    await recorder.wait(1000)
  })

  // Click "Review →"
  await recorder.wait(500)
  console.log('  Clicking Review →')
  await recorder.click(page.locator('.init-btn-secondary', { hasText: 'Review' }))
  await recorder.wait(2000)

  // ─── Segment 4: Review — Framework ─────────────────────────────────
  console.log('Segment 4: Review — Framework')
  await page.waitForSelector('.init-step-review', { timeout: 10_000 })
  await page.waitForSelector('.review-panel', { timeout: 10_000 })
  await recorder.wait(1000)

  // Hover over the detected framework name
  await tryAction('framework name', async () => {
    await recorder.hover('.init-grid .init-field:nth-child(1) input')
    await recorder.wait(800)
  })

  // Click into the styling field to show it's editable
  await tryAction('styling field', async () => {
    await recorder.click('.init-field-full input')
    await recorder.wait(1200)
  })

  // Navigate to Themes & Tokens via sub-step dot
  await recorder.click('.review-subnav-item:nth-child(2)')
  await recorder.wait(800)

  // ─── Segment 5: Review — Themes & Tokens ───────────────────────────
  console.log('Segment 5: Review — Themes & Tokens')
  await tryAction('token editor', async () => {
    await page.waitForSelector('.init-token-editor', { timeout: 5000 })
    await recorder.wait(800)

    // Show the variant toggle
    const variantTabs = await page.$$('.variant-tab')
    if (variantTabs.length > 1) {
      await recorder.click('.variant-tab:nth-child(2)')
      await recorder.wait(1000)
      await recorder.click('.variant-tab:nth-child(1)')
      await recorder.wait(800)
    }

    // Click through the category tabs
    for (const label of ['Colors', 'Type', 'Spacing', 'Borders']) {
      const tab = page.locator('.theme-tab', { hasText: label })
      if (await tab.count() > 0) {
        await recorder.click(tab)
        await recorder.wait(600)

        // Scroll through Colors tokens
        if (label === 'Colors') {
          await recorder.wait(400)
          await page.evaluate(() => {
            const el = document.querySelector('.theme-content')
            if (el) el.scrollTo({ top: el.scrollHeight / 2, behavior: 'smooth' })
          })
          await recorder.wait(1500)
          await page.evaluate(() => {
            const el = document.querySelector('.theme-content')
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
          })
          await recorder.wait(1500)
          await page.evaluate(() => {
            const el = document.querySelector('.theme-content')
            if (el) el.scrollTo({ top: 0, behavior: 'smooth' })
          })
          await recorder.wait(800)
        }
      }
    }

    // Back to Colors
    const colorsTab = page.locator('.theme-tab', { hasText: 'Colors' })
    if (await colorsTab.count() > 0) {
      await recorder.click(colorsTab)
      await recorder.wait(500)
    }
  })

  // Navigate to Components via sub-step dot
  await recorder.click('.review-subnav-item:nth-child(3)')
  await recorder.wait(800)

  // ─── Segment 6: Review — Components ────────────────────────────────
  console.log('Segment 6: Review — Components')
  await page.waitForSelector('.review-panel', { timeout: 5000 })
  await recorder.wait(1500)

  // Navigate to APIs & Data via sub-step dot
  await recorder.click('.review-subnav-item:nth-child(4)')
  await recorder.wait(800)

  // ─── Segment 7: Review — APIs & Data ───────────────────────────────
  console.log('Segment 7: Review — APIs & Data')
  await page.waitForSelector('.review-panel', { timeout: 5000 })
  await recorder.wait(800)

  // These tabs may or may not exist depending on what the scan found
  await tryAction('API/Data tabs', async () => {
    const panelTabs = await page.$$('.panel-tab')
    if (panelTabs.length === 0) {
      await recorder.wait(1000)
      return
    }

    // Show the API schemas tab
    await recorder.hover('.panel-tab:nth-child(1)')
    await recorder.wait(800)

    // Switch to Data sources tab
    const dataTab = page.locator('.panel-tab', { hasText: 'Data sources' })
    if (await dataTab.count() > 0) {
      await recorder.click(dataTab)
      await recorder.wait(1500)
    }
  })

  // Navigate to Style Guide via sub-step dot
  await recorder.click('.review-subnav-item:nth-child(5)')
  await recorder.wait(800)

  // ─── Segment 8: Review — Style Guide ───────────────────────────────
  console.log('Segment 8: Review — Style Guide')
  await page.waitForSelector('.review-panel', { timeout: 5000 })
  await recorder.wait(500)

  // Scroll through the style guide preview
  await tryAction('style guide preview', async () => {
    const preview = page.locator('.init-style-preview.markdown-body')
    if (await preview.count() === 0) return

    await page.evaluate(() => {
      const el = document.querySelector('.init-style-preview')
      if (el) el.scrollTo({ top: el.scrollHeight / 3, behavior: 'smooth' })
    })
    await recorder.wait(2000)
    await page.evaluate(() => {
      const el = document.querySelector('.init-style-preview')
      if (el) el.scrollTo({ top: (el.scrollHeight * 2) / 3, behavior: 'smooth' })
    })
    await recorder.wait(2000)
    await page.evaluate(() => {
      const el = document.querySelector('.init-style-preview')
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    })
    await recorder.wait(1500)
  })

  // Toggle to Edit mode — the button text has an icon + " Edit" / " Preview"
  await tryAction('style guide edit toggle', async () => {
    // Use nth-child: first button = Preview, second = Edit
    const editBtn = page.locator('.init-guide-toggle .init-guide-mode').nth(1)
    if (await editBtn.count() === 0) return
    await recorder.click(editBtn)
    await recorder.wait(1500)

    // Type in "Load from file" input
    const fileInput = await page.$('.init-guide-file-input')
    if (fileInput) {
      await recorder.click('.init-guide-file-input')
      await recorder.type('.init-guide-file-input', 'docs/CONTRIBUTING.md', { delay: 60 })
      await recorder.wait(1000)
      await page.fill('.init-guide-file-input', '')
    }

    // Toggle back to Preview
    const previewBtn = page.locator('.init-guide-toggle .init-guide-mode').nth(0)
    await recorder.click(previewBtn)
    await recorder.wait(800)
  })

  // Navigate to Agent Directions via sub-step dot (6th = last)
  await recorder.click('.review-subnav-item:nth-child(6)')
  await recorder.wait(800)

  // ─── Segment 9: Review — Agent Directions ──────────────────────────
  console.log('Segment 9: Review — Agent Directions')
  await page.waitForSelector('.review-panel-agents', { timeout: 10_000 })
  await recorder.wait(800)

  // Show the permission mode dropdown
  await tryAction('permission mode', async () => {
    await recorder.hover('[data-testid="init-permission-mode"]')
    await recorder.wait(800)
  })

  // Click on the "Designer" agent
  await tryAction('designer agent', async () => {
    await recorder.click(page.locator('.adp-item-name', { hasText: 'Designer' }))
    await recorder.wait(1000)

    // Scroll through directions
    const preview = page.locator('.adp-preview.markdown-body')
    if (await preview.count() > 0) {
      await page.evaluate(() => {
        const el = document.querySelector('.adp-preview')
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      })
      await recorder.wait(2000)
    }
  })

  // Click on "Accessibility" agent
  await tryAction('accessibility agent', async () => {
    await recorder.click(page.locator('.adp-item-name', { hasText: 'Accessibility' }))
    await recorder.wait(1500)
  })

  // Go back to "Designer" and change its provider
  await tryAction('change designer provider', async () => {
    await recorder.click(page.locator('.adp-item-name', { hasText: 'Designer' }))
    await recorder.wait(800)

    const provSelect = '.adp-runtime .adp-field:nth-child(1) .adp-select'
    if (await page.$(provSelect)) {
      await recorder.click(provSelect)
      await recorder.wait(300)
      await page.selectOption(provSelect, 'opencode-local')
      await recorder.wait(1500)
    }
  })

  // Show directions are editable
  await tryAction('edit toggle', async () => {
    const editBtn = page.locator('.adp-toggle .adp-mode', { hasText: 'Edit' })
    if (await editBtn.count() === 0) return
    await recorder.click(editBtn)
    await recorder.wait(1500)
    await recorder.click(page.locator('.adp-toggle .adp-mode', { hasText: 'Preview' }))
    await recorder.wait(800)
  })

  // ─── Segment 10: Save & Done ───────────────────────────────────────
  console.log('Segment 10: Save & Done')
  await recorder.click(page.locator('.review-nav-right .init-btn-primary', { hasText: 'Accept' }))

  // Wait for success / wizard close
  await page.waitForSelector('.init-success', { timeout: 15_000 }).catch(() => {})
  await recorder.wait(1000)
  await page.waitForSelector('.init-modal-backdrop', { state: 'hidden', timeout: 10_000 }).catch(() => {})
  await recorder.wait(2000)

  // Hover over a UI element in the app iframe
  await tryAction('iframe hover', async () => {
    const iframe = page.frameLocator('.app-iframe')
    const heading = iframe.locator('h1').first()
    await recorder.hover(heading)
    await recorder.wait(2000)
  })

  // ─── Finalize ──────────────────────────────────────────────────────
  const result = await recorder.stop()

  console.log('\n✓ Recording complete!')
  if (result.video) console.log(`  Video: ${result.video}`)
  console.log(`  Screenshots: ${result.screenshots.length}`)

  await browser.close()
}

main().catch((err) => {
  console.error('Recording failed:', err)
  process.exit(1)
})
