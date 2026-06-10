#!/usr/bin/env node
/**
 * Sync the canonical skills/ tree into the in-repo skill mirrors.
 *
 * `skills/` is the single source of truth for the published agent skills.
 * Three directories carry copies that drift if they're edited by hand:
 *
 *   - .claude/skills/                                  (this repo's own Claude setup)
 *   - .agents/skills/                                  (agents.md-style consumers)
 *   - playgrounds/simple/vue-webpack/.claude/skills/   (playground that exercises init-skills)
 *
 * This script replaces each mirrored skill directory with a verbatim copy of
 * the canonical one. Extra directories in a mirror that have NO canonical
 * counterpart (the vue-webpack playground's hand-written `annotask-watch`
 * skill) are left in place — they have no source to sync from.
 *
 * CI runs this script and fails on `git diff --exit-code` over the mirrors,
 * so editing a mirror directly will break the build until the canonical copy
 * is updated and re-synced. Run via `pnpm sync:skills`.
 */
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const canonicalDir = path.join(repoRoot, 'skills')

const mirrors = [
  '.claude/skills',
  '.agents/skills',
  'playgrounds/simple/vue-webpack/.claude/skills',
]

let canonicalSkills
try {
  canonicalSkills = readdirSync(canonicalDir).filter((name) =>
    statSync(path.join(canonicalDir, name)).isDirectory()
  )
} catch (err) {
  console.error(`[sync-skills] Cannot read canonical skills dir ${canonicalDir}: ${err.message}`)
  process.exit(1)
}

if (canonicalSkills.length === 0) {
  console.error(`[sync-skills] No skill directories found under ${canonicalDir} — refusing to wipe mirrors.`)
  process.exit(1)
}

for (const mirror of mirrors) {
  const mirrorDir = path.join(repoRoot, mirror)
  mkdirSync(mirrorDir, { recursive: true })

  for (const skill of canonicalSkills) {
    const src = path.join(canonicalDir, skill)
    const dest = path.join(mirrorDir, skill)
    // Remove-then-copy so files deleted from the canonical skill disappear
    // from the mirror too (cpSync alone would leave orphans behind).
    rmSync(dest, { recursive: true, force: true })
    cpSync(src, dest, { recursive: true })
    console.log(`[sync-skills] skills/${skill} → ${mirror}/${skill}`)
  }

  // Report (but keep) mirror-only skills — e.g. the vue-webpack playground's
  // annotask-watch skill, which has no canonical source.
  const extras = readdirSync(mirrorDir).filter(
    (name) => statSync(path.join(mirrorDir, name)).isDirectory() && !canonicalSkills.includes(name)
  )
  for (const extra of extras) {
    console.log(`[sync-skills] kept mirror-only skill ${mirror}/${extra} (no canonical source)`)
  }
}
