import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * Thrown when a `set()` carries a stale (or missing) `rev` against a doc that
 * already has one. The HTTP layer maps this to a 409 `conflict` so the losing
 * tab reloads instead of last-writer-wins clobbering the other writer.
 */
export class RevConflictError extends Error {
  constructor(public readonly currentRev: number, incomingRev: unknown, what = 'document') {
    super(`${what} rev conflict: document is at rev ${currentRev}, write carried rev ${String(incomingRev)}`)
    this.name = 'RevConflictError'
  }
}

/**
 * Generic compare-and-set JSON document store — the wireframe-store pattern
 * (no in-memory cache: the file is small and may be edited externally, so
 * always read fresh; atomic tmp+rename writes; CAS on `rev`) lifted so new
 * documents (design session, …) don't re-implement it. `wireframe-store.ts`
 * itself is left untouched — consolidating it onto this is a separate chore.
 */
export function createJsonCasStore<T extends { rev?: number }>(
  filePath: string,
  opts: {
    /** Shape guard — malformed disk content falls back to `empty()`. */
    validate: (v: unknown) => v is T
    empty: () => T
    /** Used in conflict error messages (e.g. 'Design session'). */
    label?: string
  },
) {
  async function load(): Promise<T> {
    try {
      const raw = JSON.parse(await fsp.readFile(filePath, 'utf-8'))
      return opts.validate(raw) ? raw : opts.empty()
    } catch {
      return opts.empty()
    }
  }

  async function persist(doc: T): Promise<void> {
    const dir = path.dirname(filePath)
    await fsp.mkdir(dir, { recursive: true })
    const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`
    await fsp.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf-8')
    await fsp.rename(tmp, filePath)
  }

  return {
    get: load,
    /** CAS write: enforced once the on-disk doc carries a rev; a fresh/legacy
     *  doc accepts any write, which stamps rev 1. Returns the stamped doc. */
    set: async (doc: T): Promise<T> => {
      const current = await load()
      if (typeof current.rev === 'number' && doc.rev !== current.rev) {
        throw new RevConflictError(current.rev, doc.rev, opts.label ?? 'Document')
      }
      const stamped: T = { ...doc, rev: (current.rev ?? 0) + 1 }
      await persist(stamped)
      return stamped
    },
    /** Unconditional replace (server-owned mutations like discard) — still
     *  bumps the rev so concurrent CAS writers lose cleanly. */
    replace: async (doc: T): Promise<T> => {
      const current = await load()
      const stamped: T = { ...doc, rev: (current.rev ?? 0) + 1 }
      await persist(stamped)
      return stamped
    },
  }
}
