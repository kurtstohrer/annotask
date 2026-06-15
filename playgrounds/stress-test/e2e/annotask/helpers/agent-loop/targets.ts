/**
 * Agent-loop e2e: per-MFE target file layout.
 *
 * Each target MFE has a dedicated test-only component plus a tracer
 * stylesheet. Tests rewrite these files via the simulator, verify the
 * iframe DOM picks up the change through Vite HMR, then restore the
 * captured originals in `afterEach`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')

export interface AgentLoopApp {
  /** stress-test MFE id (matches `playgrounds/stress-test/e2e/annotask/fixtures/apps.ts`) */
  id: 'react-workflows' | 'vue-data-lab'
  /** dev server port */
  port: number
  /** Human-readable framework label, used in metrics. */
  framework: 'react+vite' | 'vue+vite'
  /** Absolute path to the AgentLoopTarget component file. */
  componentPath: string
  /** Absolute path to the tracer stylesheet. */
  cssPath: string
}

export const AGENT_LOOP_APPS: AgentLoopApp[] = [
  {
    id: 'react-workflows',
    port: 4210,
    framework: 'react+vite',
    componentPath: join(
      REPO_ROOT,
      'playgrounds/stress-test/apps/mfe-react-workflows/src/AgentLoopTarget.tsx',
    ),
    cssPath: join(
      REPO_ROOT,
      'playgrounds/stress-test/apps/mfe-react-workflows/src/agent-loop-target.css',
    ),
  },
  {
    id: 'vue-data-lab',
    port: 4220,
    framework: 'vue+vite',
    componentPath: join(
      REPO_ROOT,
      'playgrounds/stress-test/apps/mfe-vue-data-lab/src/AgentLoopTarget.vue',
    ),
    cssPath: join(
      REPO_ROOT,
      'playgrounds/stress-test/apps/mfe-vue-data-lab/src/agent-loop-target.css',
    ),
  },
]

export interface CapturedFile {
  path: string
  contents: string
}

export function capture(paths: string[]): CapturedFile[] {
  return paths.map(p => ({ path: p, contents: readFileSync(p, 'utf8') }))
}

export function restore(files: CapturedFile[]): void {
  for (const f of files) writeFileSync(f.path, f.contents)
}
