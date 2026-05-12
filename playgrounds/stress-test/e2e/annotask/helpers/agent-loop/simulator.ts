/**
 * Agent-loop simulator.
 *
 * Drives the same MCP-shaped tool sequence a real coding agent would
 * follow when working through `skills/annotask-apply/SKILL.md`:
 *
 *   1. `annotask_get_task` to fetch full task detail
 *   2. `annotask_update_task` → `in_progress` to lock the task
 *   3. Apply a deterministic fix to the source file the task points at
 *   4. `annotask_update_task` → `review` with a one-line resolution
 *
 * Quality of the apply step is intentionally rule-based, not LLM-driven —
 * v1 of this harness exists to measure the *loop plumbing*, not the
 * agent's reasoning. See `docs/agent-loop-evals.md` for what that
 * means and which ticket owns LLM apply quality.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { getTask, updateTaskStatus } from './cli'

export interface SimulatorResult {
  taskId: string
  resolution: string
  /** Wall-clock ms across the locked → review transition. */
  durationMs: number
  /** Always 0 for v1 — the simulator never re-tries. */
  retries: number
}

export interface StyleUpdateInput {
  taskId: string
  port: number
  cssPath: string
  selector: string
  property: string
  before: string
  after: string
}

export interface A11yFixInput {
  taskId: string
  port: number
  componentPath: string
  /** axe-core rule id; v1 only supports `image-alt`. */
  rule: string
}

export interface ErrorFixInput {
  taskId: string
  port: number
  componentPath: string
  /** Marker comment that the simulator removes. */
  marker: string
}

async function lockAndReview<T>(
  taskId: string,
  port: number,
  apply: () => T,
  resolutionFor: (applied: T) => string,
): Promise<SimulatorResult> {
  const started = Date.now()
  // Hydrate full task detail (mirrors annotask_get_task) — surfaces a
  // clear error if the test never seeded the task.
  getTask(port, taskId)
  updateTaskStatus(port, taskId, 'in_progress')
  const applied = apply()
  const resolution = resolutionFor(applied)
  updateTaskStatus(port, taskId, 'review', resolution)
  return { taskId, resolution, durationMs: Date.now() - started, retries: 0 }
}

export async function applyStyleUpdate(input: StyleUpdateInput): Promise<SimulatorResult> {
  return lockAndReview(
    input.taskId,
    input.port,
    () => {
      const css = readFileSync(input.cssPath, 'utf8')
      // Replace the literal `before` value following the selector block.
      // The tracer CSS is hand-shaped so a single replacement is safe.
      const next = css.replace(input.before, input.after)
      if (next === css) {
        throw new Error(
          `style_update simulator: '${input.before}' not found in ${input.cssPath}`,
        )
      }
      writeFileSync(input.cssPath, next)
      return { property: input.property, before: input.before, after: input.after }
    },
    a => `Swapped ${a.property} from ${a.before} to ${a.after} in agent-loop-target.css`,
  )
}

export async function applyA11yFix(input: A11yFixInput): Promise<SimulatorResult> {
  return lockAndReview(
    input.taskId,
    input.port,
    () => {
      if (input.rule !== 'image-alt') {
        throw new Error(
          `a11y_fix simulator: rule '${input.rule}' is not in the v1 deterministic rule set`,
        )
      }
      const file = readFileSync(input.componentPath, 'utf8')
      // Match an <img ...> opening tag that doesn't already have an `alt=`
      // attribute and inject `alt=""`. Works for both JSX and Vue
      // templates because we never spread props onto <img> in these
      // tracer files.
      const next = file.replace(
        /<img(?![^>]*\balt=)([^>]*?)(\s*\/?)>/g,
        '<img$1 alt=""$2>',
      )
      if (next === file) {
        throw new Error(
          `a11y_fix simulator: no <img> without alt found in ${input.componentPath}`,
        )
      }
      writeFileSync(input.componentPath, next)
      return { rule: input.rule }
    },
    a => `Added alt="" to <img> per WCAG ${a.rule}`,
  )
}

export async function applyErrorFix(input: ErrorFixInput): Promise<SimulatorResult> {
  return lockAndReview(
    input.taskId,
    input.port,
    () => {
      const file = readFileSync(input.componentPath, 'utf8')
      const lines = file.split('\n')
      const matched: number[] = []
      const kept = lines.filter((line, idx) => {
        if (line.includes(input.marker)) {
          matched.push(idx + 1)
          return false
        }
        return true
      })
      if (matched.length === 0) {
        throw new Error(
          `error_fix simulator: marker '${input.marker}' not found in ${input.componentPath}`,
        )
      }
      writeFileSync(input.componentPath, kept.join('\n'))
      return { matched, ext: extname(input.componentPath) }
    },
    a => `Removed ${a.matched.length} line(s) marked '${a.ext}' tracer`,
  )
}
