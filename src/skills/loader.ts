import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** A single bundled skill: the canonical `SKILL.md` plus any companion `*.md`
 *  playbooks that live next to it (e.g. `A11Y_RULES.md`, `THEME_UPDATE.md`). */
export interface LoadedSkill {
  name: string
  /** Contents of `SKILL.md` — the canonical entry point. */
  body: string
  /** All markdown files in the skill directory keyed by basename. Always
   *  includes `'SKILL.md'`. */
  files: Record<string, string>
}

export interface LoaderOptions {
  /** Override the skills root directory. Default: resolved relative to this
   *  module — works for both `src/skills/loader.ts` (dev) and
   *  `dist/server.js` (bundled). */
  root?: string
}

const skillCache = new Map<string, LoadedSkill>()
const promptCache = new Map<string, string>()

function locateSkillsRoot(override?: string): string {
  if (override) return override
  // Walk up from this module looking for a `skills/` directory that contains
  // at least one entry with a `SKILL.md` (the bundled-package marker). This
  // avoids false matches when an upstream `src/skills/` directory exists at
  // dev time without any child skill folders.
  const here = path.dirname(fileURLToPath(import.meta.url))
  let dir = here
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'skills')
    try {
      if (fs.statSync(candidate).isDirectory()) {
        const hasSkill = fs.readdirSync(candidate).some(name => {
          try { return fs.existsSync(path.join(candidate, name, 'SKILL.md')) }
          catch { return false }
        })
        if (hasSkill) return candidate
      }
    } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`[annotask/skills] Could not locate skills/ root from ${here}`)
}

/** Load a single skill by name. Cached — repeat calls return the same
 *  object. Throws when the skill directory or its `SKILL.md` is missing. */
export function loadSkill(name: string, opts: LoaderOptions = {}): LoadedSkill {
  const key = `${opts.root ?? ''}::${name}`
  const hit = skillCache.get(key)
  if (hit) return hit

  const root = locateSkillsRoot(opts.root)
  const dir = path.join(root, name)
  const skillFile = path.join(dir, 'SKILL.md')
  if (!fs.existsSync(skillFile)) {
    throw new Error(`[annotask/skills] Skill not found: ${name} (looked in ${dir})`)
  }

  const body = fs.readFileSync(skillFile, 'utf-8')
  const files: Record<string, string> = { 'SKILL.md': body }
  for (const entry of fs.readdirSync(dir)) {
    if (entry === 'SKILL.md') continue
    if (!entry.endsWith('.md')) continue
    const p = path.join(dir, entry)
    try {
      if (!fs.statSync(p).isFile()) continue
    } catch { continue }
    files[entry] = fs.readFileSync(p, 'utf-8')
  }

  const skill: LoadedSkill = { name, body, files }
  skillCache.set(key, skill)
  return skill
}

/** List installed skill names — directories under `skills/` that contain a
 *  `SKILL.md`. */
export function listSkills(opts: LoaderOptions = {}): string[] {
  const root = locateSkillsRoot(opts.root)
  return fs.readdirSync(root)
    .filter(name => {
      try { return fs.existsSync(path.join(root, name, 'SKILL.md')) }
      catch { return false }
    })
    .sort()
}

export interface SystemPromptOptions extends LoaderOptions {
  /** Annotask task type — when provided, appends the matching companion
   *  playbook (`A11Y_RULES.md` for `a11y_fix`, `THEME_UPDATE.md` for
   *  `theme_update`). Unknown task types are a no-op. */
  taskType?: string
}

const TASK_TYPE_COMPANIONS: Record<string, string> = {
  a11y_fix: 'A11Y_RULES.md',
  theme_update: 'THEME_UPDATE.md',
}

/** Assemble the agent-facing system prompt: `annotask-apply` SKILL.md, plus
 *  the task-type companion playbook when relevant. The MCP server and the
 *  (future) embedded runner both consume this so prompt content can never
 *  drift between the two surfaces. */
export function getSystemPrompt(opts: SystemPromptOptions = {}): string {
  const key = `${opts.root ?? ''}::${opts.taskType ?? ''}`
  const hit = promptCache.get(key)
  if (hit) return hit

  const apply = loadSkill('annotask-apply', opts)
  const parts: string[] = [apply.body]
  const companion = opts.taskType ? TASK_TYPE_COMPANIONS[opts.taskType] : undefined
  if (companion && apply.files[companion]) {
    parts.push(apply.files[companion])
  }
  const prompt = parts.join('\n\n---\n\n')
  promptCache.set(key, prompt)
  return prompt
}

/** Reset the loader's in-memory caches. Tests only — production callers rely
 *  on the bundled skill files being immutable. */
export function clearSkillsCache(): void {
  skillCache.clear()
  promptCache.clear()
}
