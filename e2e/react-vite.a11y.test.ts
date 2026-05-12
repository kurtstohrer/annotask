import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

/**
 * Recording-readiness guard for the `a11y_fix` demo on the React + Vite
 * playground (ANN-10).
 *
 * The 90-second demo opens the playground, scans the Hero CTA for a11y
 * violations, and lets the agent apply a token-level fix. For that to be
 * recording-clean we need two things to hold on `main`:
 *   1. The default playground state has exactly one Hero color-contrast hit
 *      that maps to `var(--accent)` + `var(--text-on-accent)` — so the demo
 *      has a real failure to scan.
 *   2. Darkening `--accent` at the token definition clears the violation
 *      without touching component CSS — so the agent's first-try token fix
 *      is mechanically guaranteed to work.
 *
 * Both checks run against the live playground at port 5174 (see
 * `playwright.config.ts`). axe-core is injected directly from
 * `node_modules` so we don't need `@axe-core/playwright` as a dep.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const axePath = path.join(repoRoot, 'node_modules', 'axe-core', 'axe.min.js')
const axeSource = fs.readFileSync(axePath, 'utf-8')
const tokensPath = path.join(
  repoRoot,
  'playgrounds',
  'simple',
  'react-vite',
  'src',
  'styles',
  'tokens.css',
)

interface AxeNode {
  target: string[]
  html: string
  failureSummary: string
  any: Array<{ id: string; data?: { fgColor?: string; bgColor?: string; contrastRatio?: number } }>
}
interface AxeRunResult {
  violations: Array<{ id: string; nodes: AxeNode[] }>
}

async function runContrast(page: import('@playwright/test').Page): Promise<AxeRunResult> {
  await page.evaluate(axeSource)
  return await page.evaluate(async () => {
    // @ts-ignore - axe is global once injected
    return await axe.run(document, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
      resultTypes: ['violations'],
    })
  })
}

function heroCtaNodes(result: AxeRunResult): AxeNode[] {
  const contrast = result.violations.find(v => v.id === 'color-contrast')
  if (!contrast) return []
  return contrast.nodes.filter(n => n.html.includes('data-annotask-file="src/components/Hero.tsx"'))
}

test.describe('React + Vite a11y_fix recording readiness', () => {
  test('default playground has the Hero CTA color-contrast violation the demo expects', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const result = await runContrast(page)
    const heroHits = heroCtaNodes(result)
    expect(
      heroHits.length,
      'Hero primary CTA must trigger a color-contrast violation so the demo has something to scan',
    ).toBeGreaterThan(0)

    const cta = heroHits[0]
    const contrastData = cta.any.find(a => a.id === 'color-contrast')?.data
    expect(contrastData, 'axe must surface fg/bg/ratio for the demo violation').toBeTruthy()
    expect(contrastData?.fgColor?.toLowerCase()).toBe('#ffffff')
    expect(contrastData?.bgColor?.toLowerCase()).toBe('#007bff')
    expect(contrastData?.contrastRatio ?? 99).toBeLessThan(4.5)
  })

  test('tokens.css resolves the violation when --accent is darkened at the definition', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const before = heroCtaNodes(await runContrast(page))
    expect(before.length).toBeGreaterThan(0)

    // Simulate the agent's first-try token-level fix in-page only — do not
    // touch tokens.css on disk, so the recording state on main stays
    // "failing by default".
    await page.addStyleTag({
      content: `:root, :root[data-theme="dark"] { --accent: #0061f2; }`,
    })

    const after = heroCtaNodes(await runContrast(page))
    expect(
      after.length,
      'Darkening --accent at the token definition must clear the Hero CTA violation',
    ).toBe(0)
  })

  test('Hero CTA CSS still references the token (no inline hex override creeps back in)', async () => {
    const hero = fs.readFileSync(
      path.join(
        repoRoot,
        'playgrounds',
        'simple',
        'react-vite',
        'src',
        'components',
        'Hero.module.css',
      ),
      'utf-8',
    )
    expect(hero).toMatch(/\.primary\s*\{[\s\S]*?background:\s*var\(--accent\)/)
    expect(hero).toMatch(/\.primary\s*\{[\s\S]*?color:\s*var\(--text-on-accent\)/)

    const tokens = fs.readFileSync(tokensPath, 'utf-8')
    // Dark theme default keeps the well-known failing value so the demo has
    // a deterministic scan target. If this ever shifts, update the e2e and
    // the readiness note together.
    expect(tokens).toMatch(/--accent:\s*#007bff/)
  })
})
