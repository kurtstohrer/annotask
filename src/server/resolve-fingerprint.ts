/**
 * Resolve DOM evidence (class names, a text literal, a tag) from an
 * unanchored element to candidate source locations. Wireframe blocks captured
 * without a `data-annotask-file/-line` anchor still carry a fingerprint
 * (selector classes + leading text) — this module greps project source for
 * that evidence and ranks the hits so an agent can re-anchor the block before
 * editing. Best-effort line-by-line regex scan; no AST.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'
import { resolveWorkspace } from './workspace.js'
import { scanComponentUsage } from './component-usage.js'

export interface FingerprintEvidence {
  /** Class names off the element (whole-token matched). */
  classes?: string[]
  /** Leading text content — ignored when under 3 chars after trimming. */
  text?: string
  /** Tag/component name — weak tiebreak only, never evidence on its own. */
  tag?: string
  /** Max candidates to return. Default 5, max 20. */
  limit?: number
}

export interface FingerprintCandidate {
  /** projectRoot-relative path, forward slashes. */
  file: string
  /** 1-based line of the matching source line. */
  line: number
  /** 0..1, rounded to 2 decimals. Ambiguous evidence divides the score. */
  score: number
  /** The trimmed matching line, capped at 200 chars. */
  excerpt: string
}

export interface ResolveFingerprintResult {
  candidates: FingerprintCandidate[]
  /** Files actually read and scanned — honest even when caps kick in. */
  searched_files: number
  /** True when the file-list scan hit MAX_FILES_SCANNED and stopped early —
   *  candidates may be missing matches that live in unscanned files. */
  capped: boolean
}

const SCAN_EXTS = new Set(['.vue', '.jsx', '.tsx', '.svelte', '.astro', '.html', '.erb', '.php', '.heex', '.ts', '.js'])
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.annotask', 'coverage'])
/** Conventional template/markup roots — only these are walked when present,
 *  so a repo's scripts/, docs/, etc. don't dilute the ranking. */
const SOURCE_DIRS = ['src', 'app', 'components', 'pages', 'templates', 'views']
const MAX_FILES_SCANNED = 2000
const MAX_FILE_BYTES = 512 * 1024
const MAX_EXCERPT_CHARS = 200
const MIN_TEXT_CHARS = 3
const TAG_BONUS = 0.05

// Score tiers, highest first: a line holding both a class token and the text
// is near-certainly the element; all class tokens together is next; text
// alone beats a single class token (class names repeat, copy rarely does).
const SCORE_CLASS_AND_TEXT = 1.0
const SCORE_ALL_CLASSES = 0.8
const SCORE_TEXT_ONLY = 0.6
const SCORE_SINGLE_CLASS = 0.4
// A hit in a file the running package's own component-usage scan already
// knows about (imported or tag-used somewhere in that package) outranks a
// same-score coincidence in an unrelated workspace sibling.
const RUNNING_PACKAGE_BONUS = 0.03

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True when the evidence can actually drive a search: at least one non-empty
 * class token, or a text literal of >= 3 chars after trimming. A bare `tag`
 * is never enough — it would match every instance of that element. Boundaries
 * (HTTP 400, MCP toolError) share this check so they can't drift apart.
 */
export function hasUsableEvidence(classes: string[], text: string): boolean {
  return classes.some(c => c.trim().length > 0) || text.trim().length >= MIN_TEXT_CHARS
}

/** Whole-token class matcher. `\b` alone is wrong for CSS-ish tokens: '-' is
 *  a non-word char, so `\bbtn\b` would hit inside "btn-primary". Custom
 *  boundaries treat '-' as part of the token. */
function classTokenRegex(token: string): RegExp {
  return new RegExp(`(?<![\\w-])${escapeRegex(token)}(?![\\w-])`)
}

/** Weak tag signal: the line opens the element (`<tag`) or calls a
 *  render/factory helper (`tag(`). Deliberately simple — a tiebreak, not
 *  evidence. */
function lineMentionsTag(line: string, tag: string): boolean {
  const lower = line.toLowerCase()
  const t = tag.toLowerCase()
  return lower.includes(`<${t}`) || lower.includes(`${t}(`)
}

async function walk(dir: string, acc: string[]): Promise<void> {
  if (acc.length >= MAX_FILES_SCANNED) return
  let entries: fs.Dirent[]
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
  // Sort for deterministic ordering under the file cap.
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (acc.length >= MAX_FILES_SCANNED) return
    if (SKIP_DIRS.has(entry.name)) continue
    if (entry.name.startsWith('.')) continue
    const full = nodePath.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, acc)
    } else if (entry.isFile()) {
      if (SCAN_EXTS.has(nodePath.extname(entry.name))) acc.push(full)
    }
  }
}

/** Roots to walk: each workspace package's conventional source dirs when a
 *  monorepo config exists, else the project's own. A package with none of the
 *  conventional dirs falls back to its root (plain-HTML projects keep
 *  markup at the top level). The running package's own dirs are always
 *  ordered first — `ws.packages` is alphabetically sorted (see
 *  workspace.ts), so without this a sibling earlier in the alphabet could
 *  exhaust MAX_FILES_SCANNED before the actual running package's own files
 *  are even walked. */
async function collectScanRoots(projectRoot: string): Promise<string[]> {
  let packageDirs = [projectRoot]
  try {
    const ws = await resolveWorkspace(projectRoot)
    if (ws.isWorkspace) packageDirs = ws.packages
  } catch { /* fall through to single-root scan */ }
  const ownDir = nodePath.resolve(projectRoot)
  const ordered = [
    ...packageDirs.filter(p => nodePath.resolve(p) === ownDir),
    ...packageDirs.filter(p => nodePath.resolve(p) !== ownDir),
  ]
  const roots: string[] = []
  for (const pkg of ordered) {
    const dirs = SOURCE_DIRS.map(d => nodePath.join(pkg, d)).filter(d => fs.existsSync(d))
    if (dirs.length) roots.push(...dirs)
    else roots.push(pkg)
  }
  return roots
}

interface LineMatch {
  file: string
  line: number
  excerpt: string
  base: number
  tagHit: boolean
  /** True when the file is already known to the running package's own
   *  component-usage graph — a stronger signal than a workspace-sibling
   *  coincidence with the same evidence. */
  runningPkg: boolean
  /** Exact evidence this line matched — ambiguity divides per key, so a
   *  unique class isn't punished for sharing a tier with boilerplate. */
  evidenceKey: string
}

/**
 * Grep project source for the fingerprint evidence and rank candidates.
 * Scores divide by sqrt(total occurrences of the same matched evidence), so
 * a class that appears once ranks far above 'btn'-everywhere boilerplate.
 * Returns `{ candidates: [], searched_files }` when no evidence is usable —
 * callers gate with `hasUsableEvidence` for a proper error response.
 */
export async function resolveFingerprint(
  projectRoot: string,
  evidence: FingerprintEvidence,
): Promise<ResolveFingerprintResult> {
  const classes = (evidence.classes ?? []).map(c => c.trim()).filter(Boolean)
  const text = (evidence.text ?? '').trim()
  const usableText = text.length >= MIN_TEXT_CHARS ? text : ''
  const tag = (evidence.tag ?? '').trim()
  const limitArg = evidence.limit ?? 5
  const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(20, Math.floor(limitArg))) : 5

  if (!hasUsableEvidence(classes, usableText)) {
    return { candidates: [], searched_files: 0, capped: false }
  }

  const classRes = classes.map(c => classTokenRegex(c))

  const files: string[] = []
  for (const root of await collectScanRoots(projectRoot)) {
    if (files.length >= MAX_FILES_SCANNED) break
    await walk(root, files)
  }
  const capped = files.length >= MAX_FILES_SCANNED

  // Files the running package's own component-usage scan already knows
  // about (imported or tag-used there) — used to weight matches toward the
  // package that's actually running over same-named workspace-sibling noise.
  // Best-effort: a failure here just means no bonus, never a hard error.
  const runningPackageFiles = new Set<string>()
  try {
    const [usageIdx, ws] = await Promise.all([scanComponentUsage(projectRoot), resolveWorkspace(projectRoot)])
    for (const relFile of Object.keys(usageIdx.imports)) runningPackageFiles.add(nodePath.resolve(ws.root, relFile))
    for (const relFiles of Object.values(usageIdx.usage)) {
      for (const relFile of relFiles) runningPackageFiles.add(nodePath.resolve(ws.root, relFile))
    }
  } catch { /* no bonus, no error */ }

  let searchedFiles = 0
  const matches: LineMatch[] = []
  for (const filePath of files) {
    let content: string
    try {
      const stat = await fsp.stat(filePath)
      if (stat.size > MAX_FILE_BYTES) continue
      content = await fsp.readFile(filePath, 'utf-8')
    } catch { continue }
    searchedFiles++

    const rel = nodePath.relative(projectRoot, filePath).replace(/\\/g, '/')
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const matchedClasses = classes.filter((_, idx) => classRes[idx].test(line))
      const textHit = usableText !== '' && line.includes(usableText)

      let base: number
      if (textHit && matchedClasses.length > 0) base = SCORE_CLASS_AND_TEXT
      else if (classes.length >= 2 && matchedClasses.length === classes.length) base = SCORE_ALL_CLASSES
      else if (textHit) base = SCORE_TEXT_ONLY
      else if (matchedClasses.length > 0) base = SCORE_SINGLE_CLASS
      else continue

      matches.push({
        file: rel,
        line: i + 1,
        excerpt: line.trim().slice(0, MAX_EXCERPT_CHARS),
        base,
        tagHit: tag !== '' && lineMentionsTag(line, tag),
        runningPkg: runningPackageFiles.has(filePath),
        evidenceKey: `${base}|${[...matchedClasses].sort().join(',')}|${textHit}`,
      })
    }
  }

  // Ambiguity divisor: how many lines repo-wide matched this exact evidence.
  const evidenceCounts = new Map<string, number>()
  for (const m of matches) {
    evidenceCounts.set(m.evidenceKey, (evidenceCounts.get(m.evidenceKey) ?? 0) + 1)
  }

  const candidates = matches
    .map((m): FingerprintCandidate => {
      const bonus = (m.tagHit ? TAG_BONUS : 0) + (m.runningPkg ? RUNNING_PACKAGE_BONUS : 0)
      const raw = Math.min(1, m.base + bonus) / Math.sqrt(evidenceCounts.get(m.evidenceKey)!)
      return { file: m.file, line: m.line, score: Math.round(raw * 100) / 100, excerpt: m.excerpt }
    })
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line)
    .slice(0, limit)

  return { candidates, searched_files: searchedFiles, capped }
}
