/**
 * Per-run agent-loop eval metrics.
 *
 * Writes one JSON file per (task type, app) combination under
 * `playgrounds/stress-test/e2e/annotask/reports/agent-loop/`. The
 * shape is intentionally small — see `docs/agent-loop-evals.md` for
 * the schema and the v1 caveats around what each field means.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const REPORTS_DIR = join(__dirname, '..', '..', 'reports', 'agent-loop')

export type TaskTypeKey = 'style_update' | 'a11y_fix' | 'error_fix'
export type Outcome = 'success' | 'failure'

export interface RunMetric {
  task_type: TaskTypeKey
  app_id: string
  framework: string
  outcome: Outcome
  /** Wall-clock ms from task creation to status=review. */
  time_to_apply_ms: number | null
  retries: number
  denied_on_first_try: boolean
  task_id: string | null
  resolution: string | null
  error_message: string | null
  /** ISO 8601 string. */
  recorded_at: string
}

function safeFileName(metric: RunMetric): string {
  return `${metric.task_type}__${metric.app_id}__${Date.now()}.json`
}

export function writeMetric(metric: RunMetric): string {
  mkdirSync(REPORTS_DIR, { recursive: true })
  const file = join(REPORTS_DIR, safeFileName(metric))
  writeFileSync(file, JSON.stringify(metric, null, 2))
  return file
}

export function emptyMetric(
  taskType: TaskTypeKey,
  appId: string,
  framework: string,
): RunMetric {
  return {
    task_type: taskType,
    app_id: appId,
    framework,
    outcome: 'failure',
    time_to_apply_ms: null,
    retries: 0,
    denied_on_first_try: false,
    task_id: null,
    resolution: null,
    error_message: null,
    recorded_at: new Date().toISOString(),
  }
}
