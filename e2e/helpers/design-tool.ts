import type { Page, APIRequestContext } from '@playwright/test'

/**
 * Shared helpers for the design-tool e2e suites — the repo's first
 * task-creating/editing e2e. Encodes the hard-won gotchas from
 * todo/wireframe-to-design-tool.md: boot the wanted view via localStorage
 * BEFORE the shell loads, dismiss the InitWizard via the API (with an Origin
 * header), never trust networkidle (the shell holds a WebSocket), and count
 * framenavigated to prove edits are reload-free.
 */

export const PLANETS_FIXTURE = {
  planets: [
    { id: 1, name: 'Mercury', type: 'rocky', moons: 0, distance_from_sun_mkm: 58, radius_km: 2439, avg_temp_c: 167, color: '#b1adad' },
    { id: 2, name: 'Venus', type: 'rocky', moons: 0, distance_from_sun_mkm: 108, radius_km: 6051, avg_temp_c: 464, color: '#e6c89c' },
    { id: 3, name: 'Earth', type: 'rocky', moons: 1, distance_from_sun_mkm: 150, radius_km: 6371, avg_temp_c: 15, color: '#6b93d6' },
  ],
}

/** The /planets pages proxy to a FastAPI dev server that the Playwright
 *  webServer list doesn't boot — intercept so the suite is hermetic.
 *  page.route applies to iframe requests too (same page). */
export async function interceptPlanetsApi(page: Page): Promise<void> {
  await page.route('**/api/solar/planets*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(PLANETS_FIXTURE),
  }))
}

/** Dismiss the InitWizard server-side. Mutations require a local Origin. */
export async function skipInitWizard(request: APIRequestContext, origin: string): Promise<void> {
  await request.post('/__annotask/api/init/skip', { headers: { Origin: origin } }).catch(() => { /* already initialized */ })
}

/** Boot the shell straight into a design-tool view. localStorage must be
 *  seeded BEFORE the shell script runs — addInitScript, not page.evaluate. */
export async function bootDesignShell(page: Page, opts?: {
  route?: string
  section?: 'inspector' | 'components'
}): Promise<void> {
  const route = opts?.route ?? '/planets'
  const section = opts?.section ?? 'inspector'
  await page.addInitScript(({ route, section }) => {
    localStorage.setItem('annotask:shellView', 'design')
    localStorage.setItem('annotask:designSection', section)
    localStorage.setItem('annotask:lastRoute', route)
    // The default activePanel is 'tasks', which wins the panel v-else-if chain
    // and hides the inspector — pin it to the inspector panel.
    localStorage.setItem('annotask:activePanel', 'inspector')
    // Default interaction mode is 'interact' (clicks pass through to the app);
    // selection needs 'select'. Shell and iframe share this same-origin key.
    localStorage.setItem('annotask:mode', 'select')
  }, { route, section })
  // networkidle never fires (shell WebSocket) — domcontentloaded + settle.
  await page.goto('/__annotask/', { waitUntil: 'domcontentloaded' })
  await page.locator('.toolbar').waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(1_000)
}

/** Counts full navigations of the MAIN frame — live edits must keep this at 0. */
export function trackReloads(page: Page): () => number {
  let count = 0
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) count++
  })
  return () => count
}

export async function getDesignSession(request: APIRequestContext): Promise<{ entries: Array<Record<string, unknown>> }> {
  const res = await request.get('/__annotask/api/design-session')
  return res.json()
}

export async function discardDesignSession(request: APIRequestContext, origin: string): Promise<void> {
  await request.delete('/__annotask/api/design-session', { headers: { Origin: origin } }).catch(() => { /* best effort */ })
}

/** Hermetic slate: leftover playground tasks and wireframe placements from
 *  manual sessions would hijack the panel (Tasks wins) and remount stale
 *  placements into the iframe. */
export async function resetWorkspaceState(request: APIRequestContext, origin: string): Promise<void> {
  try {
    const tasks = (await (await request.get('/__annotask/api/tasks')).json()).tasks as Array<{ id: string }>
    for (const t of tasks) {
      await request.delete(`/__annotask/api/tasks/${t.id}`, { headers: { Origin: origin } })
    }
  } catch { /* best effort */ }
  try {
    const wf = await (await request.get('/__annotask/api/wireframe')).json()
    if (Array.isArray(wf.routes) && wf.routes.some((r: { instances: unknown[] }) => r.instances.length > 0)) {
      await request.put('/__annotask/api/wireframe', {
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        data: { version: '1.0', updatedAt: Date.now(), ...(wf.rev !== undefined ? { rev: wf.rev } : {}), routes: [] },
      })
    }
  } catch { /* best effort */ }
}
