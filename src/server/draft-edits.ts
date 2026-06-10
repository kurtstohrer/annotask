import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { resolveProjectFile } from './path-safety.js'

/**
 * Opt-in "render in place" draft edits (P1.3) — the ONLY place Annotask writes
 * to real project source. A draft writes a component usage at a dropped
 * instance's `data-annotask-file`/`-line` anchor so native Vite HMR re-renders
 * it in its true provider tree (something a detached mount can't do). The draft
 * is a PREVIEW: it feeds the wireframe task, it is not a second codegen path —
 * callers revert it after capturing the render, and the real change lands only
 * through `/annotask-apply`.
 *
 * Safety: OFF by default behind `ANNOTASK_RENDER_IN_PLACE`. The original bytes
 * are held in memory AND journaled to `.annotask/draft-edits.json` so a process
 * crash mid-draft is recovered on next boot. Revert is hash-guarded — if the
 * file changed under us (a user/agent edit), we skip the restore and warn
 * rather than clobber their work.
 */

export interface DraftEditRequest {
  /** Anchor file as emitted by `data-annotask-file` (package-local) or absolute. */
  file: string
  /** Opening-tag line of the anchor element. */
  line: number
  position: 'before' | 'after' | 'append' | 'prepend'
  componentName: string
  props?: Record<string, unknown>
  /** Pre-resolved import line from the caller (component-examples). When absent,
   *  no import is added — the component must already be in scope. */
  importStatement?: string
}

interface DraftEntry {
  absPath: string
  original: string
  /** sha256 of the content we wrote — revert only proceeds if the file still
   *  matches this (i.e. no one edited it under us). */
  modifiedHash: string
  ts: number
}

export interface DraftStore {
  readonly enabled: boolean
  write: (req: DraftEditRequest) => Promise<{ draftId: string }>
  revert: (draftId: string) => Promise<{ reverted: boolean }>
  revertAll: () => Promise<void>
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function isEnabled(): boolean {
  const v = process.env.ANNOTASK_RENDER_IN_PLACE
  return v === '1' || v === 'true'
}

/** Serialize primitive props into framework-correct attribute syntax. Non-
 *  primitives are skipped — a preview never fabricates handlers/objects. */
function serializeProps(props: Record<string, unknown> | undefined, ext: string): string {
  if (!props) return ''
  const jsxLike = ext === '.jsx' || ext === '.tsx' || ext === '.svelte'
  const vue = ext === '.vue'
  const parts: string[] = []
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue
    if (typeof v === 'string') {
      parts.push(`${k}="${v.replace(/"/g, '&quot;')}"`)
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      if (jsxLike) parts.push(`${k}={${String(v)}}`)
      else if (vue) parts.push(`:${k}="${String(v)}"`)
      else parts.push(`${k}="${String(v)}"`)
    }
    // objects/functions/arrays intentionally skipped
  }
  return parts.length ? ' ' + parts.join(' ') : ''
}

function buildSnippet(req: DraftEditRequest, indent: string, ext: string): string {
  const propStr = serializeProps(req.props, ext)
  return `${indent}<${req.componentName}${propStr} />`
}

/** Insert `importStatement` after the last existing import line. For .vue we
 *  scope to the <script> block; for jsx/tsx/svelte we use top-level imports.
 *  Best-effort: returns the lines unchanged when no safe spot is found. */
function insertImport(lines: string[], importStatement: string, ext: string): string[] {
  if (lines.some((l) => l.trim() === importStatement.trim())) return lines
  const isImport = (l: string) => /^\s*import\s/.test(l)
  if (ext === '.vue') {
    const scriptIdx = lines.findIndex((l) => /<script/.test(l))
    if (scriptIdx < 0) return lines
    let lastImport = scriptIdx
    for (let i = scriptIdx + 1; i < lines.length; i++) {
      if (/<\/script>/.test(lines[i])) break
      if (isImport(lines[i])) lastImport = i
    }
    const out = lines.slice()
    out.splice(lastImport + 1, 0, importStatement)
    return out
  }
  let lastImport = -1
  for (let i = 0; i < lines.length; i++) {
    if (isImport(lines[i])) lastImport = i
  }
  const out = lines.slice()
  out.splice(lastImport + 1, 0, importStatement)
  return out
}

export function createDraftStore(projectRoot: string): DraftStore {
  const enabled = isEnabled()
  const journalPath = path.join(projectRoot, '.annotask', 'draft-edits.json')
  const drafts = new Map<string, DraftEntry>()
  let counter = 0

  function resolveAbs(file: string): string {
    // Containment: this is the ONLY arbitrary-write path in the server, so
    // the target must resolve inside projectRoot. The anchor arrives in two
    // shapes — package-local ("src/Foo.vue", validated via the shared
    // resolveProjectFile guard) or absolute (the bridge can emit the full
    // path), which resolveProjectFile rejects outright, so absolute inputs
    // get the same resolve + startsWith(root + sep) containment check inline.
    if (file.includes('\0')) throw new Error(`Invalid draft target: ${file}`)
    if (path.isAbsolute(file)) {
      const rootAbs = path.resolve(projectRoot)
      const abs = path.resolve(file)
      const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep
      if (!abs.startsWith(rootWithSep)) {
        throw new Error(`Draft target escapes the project root: ${file}`)
      }
      return abs
    }
    const resolved = resolveProjectFile(projectRoot, file)
    if (!resolved) throw new Error(`Draft target escapes the project root: ${file}`)
    return resolved.absolutePath
  }

  async function loadJournal(): Promise<Record<string, DraftEntry>> {
    try {
      const raw = JSON.parse(await fsp.readFile(journalPath, 'utf-8'))
      return raw && typeof raw === 'object' ? raw : {}
    } catch {
      return {}
    }
  }

  async function persistJournal(): Promise<void> {
    const obj: Record<string, DraftEntry> = {}
    for (const [id, e] of drafts) obj[id] = e
    await fsp.mkdir(path.dirname(journalPath), { recursive: true })
    const tmp = `${journalPath}.tmp.${process.pid}.${Date.now()}`
    await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf-8')
    await fsp.rename(tmp, journalPath)
  }

  /** Restore any drafts that survived a crash, then clear the journal. A draft
   *  is restored only if the file on disk still matches what we wrote. */
  async function recoverFromJournal(): Promise<void> {
    const journal = await loadJournal()
    let restored = 0
    for (const entry of Object.values(journal)) {
      try {
        const current = await fsp.readFile(entry.absPath, 'utf-8')
        if (sha256(current) === entry.modifiedHash) {
          await fsp.writeFile(entry.absPath, entry.original, 'utf-8')
          restored++
        }
      } catch { /* file gone — nothing to restore */ }
    }
    if (Object.keys(journal).length > 0) {
      try { await fsp.rm(journalPath, { force: true }) } catch { /* ignore */ }
    }
    if (restored > 0) console.warn(`[Annotask] recovered ${restored} render-in-place draft(s) after restart`)
  }

  // Recover stale drafts on construction (best-effort, fire-and-forget).
  if (enabled) void recoverFromJournal()

  async function write(req: DraftEditRequest): Promise<{ draftId: string }> {
    if (!enabled) throw new Error('render-in-place is disabled')
    // The import is spliced into project source verbatim — accept only a
    // single `import …` line so a crafted request can't smuggle arbitrary
    // code (a second statement after a newline, a non-import payload, …).
    if (req.importStatement !== undefined
      && (/[\r\n]/.test(req.importStatement) || !/^\s*import\s/.test(req.importStatement))) {
      throw new Error('importStatement must be a single `import …` line')
    }
    const absPath = resolveAbs(req.file)
    const original = await fsp.readFile(absPath, 'utf-8')
    const ext = path.extname(absPath)
    const lines = original.split('\n')
    const anchorIdx = Math.min(Math.max((req.line || 1) - 1, 0), lines.length - 1)
    const indentMatch = lines[anchorIdx]?.match(/^\s*/)
    const indent = indentMatch ? indentMatch[0] : ''
    const snippet = buildSnippet(req, indent, ext)
    // Approximate placement for the PREVIEW: `before` inserts above the anchor's
    // opening tag; everything else inserts just below it (the authoritative
    // placement lives in wireframe.json and is realized precisely by the agent).
    const insertAt = req.position === 'before' ? anchorIdx : anchorIdx + 1
    let next = lines.slice()
    next.splice(insertAt, 0, snippet)
    if (req.importStatement) next = insertImport(next, req.importStatement, ext)
    const modified = next.join('\n')

    const draftId = `draft-${++counter}-${Date.now()}`
    const entry: DraftEntry = { absPath, original, modifiedHash: sha256(modified), ts: Date.now() }
    drafts.set(draftId, entry)
    // Journal BEFORE writing source so a crash mid-write is recoverable.
    await persistJournal()
    // In-place write (not atomic rename) so Vite's chokidar watcher fires HMR
    // cleanly, the way an editor save would.
    await fsp.writeFile(absPath, modified, 'utf-8')
    return { draftId }
  }

  async function revert(draftId: string): Promise<{ reverted: boolean }> {
    const entry = drafts.get(draftId)
    if (!entry) return { reverted: false }
    let reverted = false
    try {
      const current = await fsp.readFile(entry.absPath, 'utf-8')
      if (sha256(current) === entry.modifiedHash) {
        await fsp.writeFile(entry.absPath, entry.original, 'utf-8')
        reverted = true
      } else {
        console.warn(`[Annotask] skipping render-in-place revert for ${entry.absPath} — file changed since the draft`)
      }
    } catch {
      console.warn(`[Annotask] could not read ${entry.absPath} to revert draft ${draftId}`)
    }
    drafts.delete(draftId)
    await persistJournal()
    return { reverted }
  }

  async function revertAll(): Promise<void> {
    for (const id of Array.from(drafts.keys())) {
      await revert(id)
    }
  }

  return {
    get enabled() { return enabled },
    write,
    revert,
    revertAll,
  }
}

export type { DraftStore as RenderInPlaceDraftStore }
