import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveProjectFile } from './path-safety.js'
import { resolveWorkspace } from './workspace.js'
import type { ApplyBatch } from '../shared/design-session-types.js'

const execFileAsync = promisify(execFile)

/**
 * File-snapshot engine — the safety net under the agent-apply loop.
 *
 * The tool NEVER authors application source; the embedded agent does. What the
 * tool guarantees is byte-exact reversibility: before an apply batch spawns
 * the agent, every file the batch touches is snapshotted here, so "Undo last
 * apply" restores that batch's pre-apply bytes and "Discard session" restores
 * every touched file to its session-base bytes.
 *
 * Journal: `.annotask/file-snapshots.json` (atomic tmp+rename, written BEFORE
 * the agent runs). Restart REHYDRATES the journal — agent-written edits are
 * intentional user work and survive dev-server restarts; files revert only
 * via explicit Undo/Discard. (The old render-in-place draft engine auto-
 * reverted on boot; its legacy journal gets that treatment exactly once.)
 *
 * Hash guard: a restore only happens when the file on disk still matches the
 * hash recorded when its batch sealed. A mismatch means the USER edited the
 * file since — the file flips to 'diverged', restores skip it, and the only
 * resolution is detachFile (keep the disk bytes, forget the file). Never
 * clobber, never rebase silently.
 *
 * Byte-exact COVERAGE: the embedded agent edits freely — shared layouts,
 * imported children, global CSS — not just the anchor files the apply
 * predicted. In a git project we capture a baseline (`git stash create`, which
 * snapshots the dirty working tree without touching it) BEFORE the agent runs,
 * then at seal `git diff` the tree against it and fold EVERY touched tracked
 * file into the batch (pre-apply bytes pulled from `git show`), so undo/discard
 * restore the agent's whole footprint, not a partial subset. An agent-DELETED
 * file is recreated from its held bytes on restore. Outside a git project (or a
 * monorepo whose toplevel isn't the project root) coverage falls back to the
 * predicted anchor files only — documented, never silent.
 */

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

interface SnapshotFileEntry {
  absPath: string
  /** Session-base bytes — captured ONCE, the first time any batch touches the file. */
  base: string
  baseHash: string
  /** sha256 of the file when its latest batch sealed; the restore hash-guard. */
  lastAppliedHash?: string
  status: 'clean' | 'diverged'
}

interface SnapshotBatch extends ApplyBatch {
  /** Pre-batch bytes per file — what "Undo last apply" restores. Seeded with
   *  the predicted anchor files at snapshot time, then EXTENDED at seal with
   *  every other tracked file the agent touched (bytes from `git show
   *  gitBaseline:file`) so undo covers the agent's whole footprint. */
  before: Record<string, string>
  /** Untracked files at snapshot time (git projects only) — the baseline the
   *  seal diffs against to net agent-CREATED files into undo. */
  untrackedBefore?: string[]
  /** `git stash create` SHA (or HEAD when the tree was clean) captured at
   *  snapshot time — the pre-apply tree the seal diffs against to discover
   *  agent-touched files and recover their pre-apply bytes. Absent outside a
   *  git project / when the repo toplevel isn't the project root. */
  gitBaseline?: string
  /** Files the agent created during this batch (rel path → sha256 at seal).
   *  Undo deletes them hash-guarded; a user-edited created file is kept. */
  created?: Record<string, string>
}

interface SnapshotJournal {
  version: 1
  files: Record<string, SnapshotFileEntry>
  batches: SnapshotBatch[]
}

export interface SnapshotState {
  files: Record<string, { baseHash: string; lastAppliedHash?: string; status: 'clean' | 'diverged' }>
  batches: Array<ApplyBatch & { created?: string[] }>
}

export interface SnapshotStore {
  /** Capture pre-batch bytes for every file (and the session base on first touch).
   *  Persisted BEFORE returning — the journal must exist before the agent runs. */
  snapshotFiles(files: string[], batch: { id: string; taskId: string }): Promise<void>
  /** Record post-apply hashes + finish the batch (the restore hash-guard baseline). */
  sealBatch(batchId: string, opts?: { failed?: boolean }): Promise<void>
  /** Seal the most-recent batch for a task — used by the review hook (which
   *  knows the taskId, not the batchId) so re-apply-after-deny and
   *  pure-instances applies still establish a hash baseline. No-op if no batch
   *  matches; re-sealing is safe (only lastAppliedHash + the created net move). */
  sealBatchByTask(taskId: string, opts?: { failed?: boolean }): Promise<void>
  /** Restore the batch's pre-apply bytes. LIFO-only: only the newest batch can
   *  be undone (out-of-order restores would resurrect older bytes). */
  revertBatch(batchId: string): Promise<{ reverted: string[]; skipped: string[] }>
  /** Discard: every touched file back to its session-base bytes (hash-guarded). */
  revertAll(): Promise<{ reverted: string[]; skipped: string[] }>
  /** Accept path: keep the bytes, drop the journal. */
  commit(): Promise<void>
  /** Diverged resolution: keep the disk bytes, forget the file entirely. */
  detachFile(file: string): Promise<void>
  /** Journal view with a fresh divergence hash-sweep. */
  state(): Promise<SnapshotState>
  flush(): Promise<void>
}

export function createSnapshotStore(projectRoot: string): SnapshotStore {
  const journalPath = path.join(projectRoot, '.annotask', 'file-snapshots.json')
  const legacyDraftJournalPath = path.join(projectRoot, '.annotask', 'draft-edits.json')

  let journal: SnapshotJournal = { version: 1, files: {}, batches: [] }
  // Workspace root, resolved once into `ready`. Broadens snapshot containment to
  // the monorepo root so a captured MFE block anchored host-project-root-
  // relative (`../mfe-x/src/App.tsx`) resolves and stays contained — the SAME
  // workspace awareness code-context/source-excerpt already use for reads.
  // Without it, a sibling-MFE `../` path throws here and strands the apply.
  // undefined for single-package projects (containment stays projectRoot).
  let workspaceRoot: string | undefined
  // Serialize every mutation: rapid apply/undo clicks and lifecycle hooks must
  // never interleave read-modify-write on the journal or the files.
  let chain: Promise<unknown> = Promise.resolve()
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn)
    chain = run.catch(() => { /* keep the chain alive */ })
    return run
  }

  function resolveAbs(file: string): string {
    // Containment: snapshot restores are the only tool-authored source writes,
    // so targets must resolve inside projectRoot — or, in a monorepo, the
    // workspace root (a sibling MFE package). Same discipline as the shared
    // resolveProjectFile / code-context guard.
    if (file.includes('\0')) throw new Error(`Invalid snapshot target: ${file}`)
    if (path.isAbsolute(file)) {
      const abs = path.resolve(file)
      const roots = [path.resolve(projectRoot), ...(workspaceRoot ? [path.resolve(workspaceRoot)] : [])]
      for (const root of roots) {
        const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
        if (abs.startsWith(rootWithSep)) return abs
      }
      throw new Error(`Snapshot target escapes the project root: ${file}`)
    }
    const resolved = resolveProjectFile(projectRoot, file, workspaceRoot)
    if (!resolved) throw new Error(`Snapshot target escapes the project root: ${file}`)
    return resolved.absolutePath
  }

  async function persist(): Promise<void> {
    await fsp.mkdir(path.dirname(journalPath), { recursive: true })
    const tmp = `${journalPath}.tmp.${process.pid}.${Date.now()}`
    await fsp.writeFile(tmp, JSON.stringify(journal, null, 2), 'utf-8')
    await fsp.rename(tmp, journalPath)
  }

  async function rehydrate(): Promise<void> {
    try {
      const raw = JSON.parse(await fsp.readFile(journalPath, 'utf-8'))
      if (raw && typeof raw === 'object' && raw.version === 1 && raw.files && Array.isArray(raw.batches)) {
        journal = raw as SnapshotJournal
      }
    } catch { /* no journal yet */ }
    // Legacy v1 render-in-place journal: those drafts were preview artifacts,
    // not user-intentional applies — give them the old restore-and-clear once.
    try {
      const legacy = JSON.parse(await fsp.readFile(legacyDraftJournalPath, 'utf-8')) as Record<string, { absPath: string; original: string; modifiedHash: string }>
      let restored = 0
      for (const entry of Object.values(legacy ?? {})) {
        try {
          const current = await fsp.readFile(entry.absPath, 'utf-8')
          if (sha256(current) === entry.modifiedHash) {
            await fsp.writeFile(entry.absPath, entry.original, 'utf-8')
            restored++
          }
        } catch { /* file gone */ }
      }
      await fsp.rm(legacyDraftJournalPath, { force: true })
      if (restored > 0) console.warn(`[Annotask] restored ${restored} legacy render-in-place draft(s)`)
    } catch { /* no legacy journal */ }
  }

  // Resolve the workspace root alongside rehydrate so it's set before any
  // store method (all `await ready` first) reaches resolveAbs. A single-package
  // project resolves to isWorkspace:false → containment stays projectRoot.
  async function resolveWorkspaceRoot(): Promise<void> {
    try {
      const info = await resolveWorkspace(projectRoot)
      if (info.isWorkspace) workspaceRoot = info.root
    } catch { /* single-package fallback — containment stays projectRoot */ }
  }
  const ready = Promise.all([rehydrate(), resolveWorkspaceRoot()]).then(() => undefined)

  /** Untracked files per `git status --porcelain -uall` (gitignore-aware), or
   *  null when this isn't a usable git project — the created-files net is then
   *  silently off (snapshotted files still restore byte-exact). */
  async function gitUntracked(): Promise<string[] | null> {
    try {
      const { stdout } = await execFileAsync(
        'git', ['status', '--porcelain', '-uall', '--no-renames'],
        { cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 },
      )
      return stdout.split('\n')
        .filter((l) => l.startsWith('?? '))
        .map((l) => l.slice(3).trim())
        // git quotes paths with special chars — those stay un-netted rather
        // than risking a wrong unlink target.
        .filter((f) => f && !f.startsWith('"') && !f.startsWith('.annotask/'))
    } catch {
      return null
    }
  }

  /** Pre-apply baseline for the byte-exact auto-extend: `git stash create`
   *  commits the dirty working tree + index to a dangling commit WITHOUT
   *  touching the tree/index/refs, returning its SHA — exactly the pre-apply
   *  snapshot we need. A clean tree produces no stash commit, so HEAD already
   *  IS the baseline. Returns null when not a git project, or when the repo
   *  toplevel isn't the project root (then `git show repo-rel:path` and our
   *  project-relative paths would disagree — coverage falls back to anchors). */
  async function gitBaselineRef(): Promise<string | null> {
    try {
      const { stdout: top } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: projectRoot })
      if (path.resolve(top.trim()) !== path.resolve(projectRoot)) return null
      const { stdout: stash } = await execFileAsync('git', ['stash', 'create'], { cwd: projectRoot, maxBuffer: 1024 * 1024 })
      const sha = stash.trim()
      if (sha) return sha
      const { stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })
      return head.trim() || null
    } catch {
      return null
    }
  }

  /** Tracked files that differ between `baseline` and the current working tree
   *  (added/modified/deleted) — the agent's footprint beyond the anchor set.
   *  Created (still-untracked) files don't appear here; they ride the
   *  untracked net. Project-relative, .annotask/ and quoted paths filtered. */
  async function gitChangedSince(baseline: string): Promise<string[]> {
    const { stdout } = await execFileAsync(
      'git', ['diff', '--name-only', '--no-renames', '--relative', baseline, '--'],
      { cwd: projectRoot, maxBuffer: 50 * 1024 * 1024 },
    )
    return stdout.split('\n').map((s) => s.trim())
      .filter((f) => f && !f.startsWith('"') && !f.startsWith('.annotask/'))
  }

  /** Pre-apply content of one tracked file from the baseline tree. null when the
   *  file didn't exist there (i.e. the agent CREATED it — handled by the
   *  untracked net, not here). */
  async function gitShow(baseline: string, file: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['show', `${baseline}:${file}`], { cwd: projectRoot, maxBuffer: 50 * 1024 * 1024 })
      return stdout
    } catch {
      return null
    }
  }

  /** Seal a found batch in place: fold in every other tracked file the agent
   *  touched (byte-exact coverage), record each touched file's post-apply hash
   *  (the restore guard baseline), and net agent-CREATED files into the batch.
   *  Idempotent enough to re-run on a second review — pre-apply bytes are only
   *  ever captured once per file (first touch wins). */
  async function sealBatchInternal(batch: SnapshotBatch, opts?: { failed?: boolean }): Promise<void> {
    // Auto-extend: fold every tracked file the agent changed beyond the
    // predicted anchor set into the batch, recovering its pre-apply bytes from
    // the baseline tree. Undo/discard then restore the agent's whole footprint.
    if (batch.gitBaseline) {
      try {
        const known = new Set(batch.files)
        for (const file of await gitChangedSince(batch.gitBaseline)) {
          if (known.has(file)) continue
          const pre = await gitShow(batch.gitBaseline, file)
          if (pre === null) continue // created (not in baseline) — netted separately
          let absPath: string
          try { absPath = resolveAbs(file) } catch { continue } // escapes root — leave it
          batch.before[file] = pre
          batch.files.push(file)
          known.add(file)
          // Session base captured on first touch only (the pre-SESSION bytes);
          // a file an earlier batch already snapshotted keeps that earlier base.
          if (!journal.files[file]) {
            journal.files[file] = { absPath, base: pre, baseHash: sha256(pre), status: 'clean' }
          }
        }
      } catch { /* diff/show failed — anchor-only coverage stands, never crash the seal */ }
    }
    for (const file of batch.files) {
      const entry = journal.files[file]
      if (!entry) continue
      try {
        entry.lastAppliedHash = sha256(await fsp.readFile(entry.absPath, 'utf-8'))
      } catch { /* file deleted by the agent — restore will recreate it */ }
    }
    // Net agent-CREATED files into the batch: anything newly untracked since
    // the snapshot baseline (and not already a snapshotted target) belongs to
    // this apply, hashed so undo only deletes pristine copies.
    if (batch.untrackedBefore) {
      const after = await gitUntracked()
      if (after) {
        const baseline = new Set(batch.untrackedBefore)
        const snapshotted = new Set(batch.files)
        const created: Record<string, string> = {}
        for (const file of after) {
          if (baseline.has(file) || snapshotted.has(file)) continue
          try {
            const abs = resolveAbs(file)
            created[file] = sha256(await fsp.readFile(abs, 'utf-8'))
          } catch { /* unreadable/escaping — leave it alone */ }
        }
        if (Object.keys(created).length > 0) batch.created = created
      }
    }
    batch.finishedAt = Date.now()
    batch.status = opts?.failed ? 'failed' : 'done'
  }

  /** Hash-guarded restore of one file to `bytes` (its pre-apply content).
   *  Recreates an agent-DELETED file (mkdir -p + write) — that IS the byte-exact
   *  undo, and the old code silently dropped it. Returns false (and marks
   *  diverged) only when the disk state isn't the one our seal left behind:
   *  the USER edited or deleted/created it since, so restoring would clobber
   *  their work. `lastAppliedHash` is the seal fingerprint — undefined means the
   *  file was ABSENT at seal (the agent deleted it during the apply). */
  async function restoreFile(relFile: string, bytes: string): Promise<boolean> {
    const entry = journal.files[relFile]
    if (!entry) return false
    const expected = entry.lastAppliedHash
    let current: string | null = null
    try {
      current = await fsp.readFile(entry.absPath, 'utf-8')
    } catch {
      current = null // absent on disk now
    }
    if (current !== null) {
      // Present now. Absent at seal (expected undefined) ⇒ the user re-created
      // it after the agent deleted it — don't clobber. Otherwise it must still
      // match the sealed bytes, or the user edited it since.
      if (expected === undefined || sha256(current) !== expected) {
        entry.status = 'diverged'
        return false
      }
    } else {
      // Absent now. Present at seal (expected set) ⇒ the user deleted it since —
      // don't silently resurrect. Absent at seal too ⇒ agent-deleted, untouched
      // by the user → recreate it from the held pre-apply bytes.
      if (expected !== undefined) {
        entry.status = 'diverged'
        return false
      }
    }
    await fsp.mkdir(path.dirname(entry.absPath), { recursive: true })
    await fsp.writeFile(entry.absPath, bytes, 'utf-8')
    entry.lastAppliedHash = sha256(bytes)
    return true
  }

  return {
    snapshotFiles(files, batch) {
      return enqueue(async () => {
        await ready
        const before: Record<string, string> = {}
        for (const file of files) {
          // Defensive: an empty/falsy or escaping target can't resolve
          // (resolveAbs throws). Callers should filter anchorless blocks, but
          // never let one bad entry abort the whole snapshot and strand a task
          // with no batch — skip it; its directions still ride the task and the
          // git auto-extend captures anything the agent actually edits.
          if (!file) continue
          let absPath: string
          try { absPath = resolveAbs(file) } catch { continue }
          let bytes = ''
          try { bytes = await fsp.readFile(absPath, 'utf-8') } catch { bytes = '' }
          before[file] = bytes
          if (!journal.files[file]) {
            // First apply wins: the session base is the pre-SESSION state.
            journal.files[file] = { absPath, base: bytes, baseHash: sha256(bytes), status: 'clean' }
          }
        }
        const untrackedBefore = await gitUntracked()
        const gitBaseline = await gitBaselineRef()
        journal.batches.push({
          id: batch.id, taskId: batch.taskId, files: [...files], startedAt: Date.now(), status: 'running', before,
          ...(untrackedBefore !== null ? { untrackedBefore } : {}),
          ...(gitBaseline ? { gitBaseline } : {}),
        })
        await persist()
      })
    },

    sealBatch(batchId, opts) {
      return enqueue(async () => {
        await ready
        const batch = journal.batches.find((b) => b.id === batchId)
        if (!batch) return
        await sealBatchInternal(batch, opts)
        await persist()
      })
    },

    sealBatchByTask(taskId, opts) {
      return enqueue(async () => {
        await ready
        // Newest batch for the task (one task → one batch today; reverse keeps
        // this correct if that ever changes).
        const batch = [...journal.batches].reverse().find((b) => b.taskId === taskId)
        if (!batch) return
        await sealBatchInternal(batch, opts)
        await persist()
      })
    },

    revertBatch(batchId) {
      return enqueue(async () => {
        await ready
        const last = journal.batches[journal.batches.length - 1]
        if (!last || last.id !== batchId) {
          throw new Error('Only the most recent apply batch can be undone')
        }
        // A 'running' batch is unsealed — its files have no lastAppliedHash, so
        // restoreFile would clobber the agent's in-progress bytes with no guard.
        // Abandoned runs are sealed 'failed' first (releaseApplyTask), so this
        // only ever refuses a batch whose agent is genuinely still writing.
        if (last.status === 'running') {
          throw new Error('This apply is still running — wait for it to finish before undoing')
        }
        const reverted: string[] = []
        const skipped: string[] = []
        for (const [file, bytes] of Object.entries(last.before)) {
          if (await restoreFile(file, bytes)) reverted.push(file)
          else skipped.push(file)
        }
        // Agent-created files: delete only pristine copies (seal-time hash).
        // A user-edited created file is THEIR work now — keep it, report it.
        for (const [file, hash] of Object.entries(last.created ?? {})) {
          try {
            const abs = resolveAbs(file)
            if (sha256(await fsp.readFile(abs, 'utf-8')) === hash) {
              await fsp.unlink(abs)
              reverted.push(file)
            } else {
              skipped.push(file)
            }
          } catch { /* already gone — nothing to undo */ }
        }
        journal.batches.pop()
        // Files whose only batch was this one and whose bytes are back at the
        // session base carry no session state — drop them so a fully-undone
        // session leaves an empty journal.
        for (const file of Object.keys(last.before)) {
          const stillReferenced = journal.batches.some((b) => file in b.before)
          const entry = journal.files[file]
          if (!stillReferenced && entry && entry.status === 'clean' && entry.lastAppliedHash === entry.baseHash) {
            delete journal.files[file]
          }
        }
        await persist()
        return { reverted, skipped }
      })
    },

    revertAll() {
      return enqueue(async () => {
        await ready
        // Same guard as revertBatch: never discard over a live, unsealed run.
        if (journal.batches.some((b) => b.status === 'running')) {
          throw new Error('An apply is still running — wait for it to finish before discarding')
        }
        const reverted: string[] = []
        const skipped: string[] = []
        for (const [file, entry] of Object.entries(journal.files)) {
          if (await restoreFile(file, entry.base)) {
            reverted.push(file)
            delete journal.files[file]
          } else {
            skipped.push(file)
          }
        }
        // Discard removes every batch's pristine agent-created files too —
        // newest batch first, so a file created then edited by a LATER batch
        // is judged against the hash that sealed last.
        const seen = new Set<string>()
        for (const batch of [...journal.batches].reverse()) {
          for (const [file, hash] of Object.entries(batch.created ?? {})) {
            if (seen.has(file)) continue
            seen.add(file)
            try {
              const abs = resolveAbs(file)
              if (sha256(await fsp.readFile(abs, 'utf-8')) === hash) {
                await fsp.unlink(abs)
                reverted.push(file)
              } else {
                skipped.push(file)
              }
            } catch { /* already gone */ }
          }
        }
        journal.batches = []
        await persist()
        return { reverted, skipped }
      })
    },

    commit() {
      return enqueue(async () => {
        await ready
        journal = { version: 1, files: {}, batches: [] }
        try { await fsp.rm(journalPath, { force: true }) } catch { /* ignore */ }
      })
    },

    detachFile(file) {
      return enqueue(async () => {
        await ready
        delete journal.files[file]
        for (const batch of journal.batches) {
          delete batch.before[file]
          batch.files = batch.files.filter((f) => f !== file)
        }
        journal.batches = journal.batches.filter((b) => b.files.length > 0)
        await persist()
      })
    },

    state() {
      return enqueue(async () => {
        await ready
        // Divergence sweep: cheap (few files per session) and keeps the panel honest.
        for (const entry of Object.values(journal.files)) {
          if (entry.lastAppliedHash === undefined || entry.status === 'diverged') continue
          try {
            const current = await fsp.readFile(entry.absPath, 'utf-8')
            if (sha256(current) !== entry.lastAppliedHash) entry.status = 'diverged'
          } catch { entry.status = 'diverged' }
        }
        return {
          files: Object.fromEntries(Object.entries(journal.files).map(([file, e]) => [
            file,
            { baseHash: e.baseHash, ...(e.lastAppliedHash !== undefined ? { lastAppliedHash: e.lastAppliedHash } : {}), status: e.status },
          ])),
          batches: journal.batches.map(({ before: _before, untrackedBefore: _ub, created, ...batch }) => ({
            ...batch,
            ...(created && Object.keys(created).length > 0 ? { created: Object.keys(created) } : {}),
          })),
        }
      })
    },

    flush() {
      return enqueue(async () => { await ready })
    },
  }
}
