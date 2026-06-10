import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  emptyWireframeDocument,
  isWireframeDocument,
  type WireframeDocument,
} from '../shared/wireframe-types.js'

/**
 * Thrown when a `set()` carries a stale (or missing) `rev` against a doc that
 * already has one. The HTTP layer maps this to a 409 `conflict` so the losing
 * tab reloads instead of last-writer-wins clobbering the other tab's
 * placements.
 */
export class WireframeRevConflictError extends Error {
  constructor(public readonly currentRev: number, incomingRev: unknown) {
    super(`Wireframe rev conflict: document is at rev ${currentRev}, write carried rev ${String(incomingRev)}`)
    this.name = 'WireframeRevConflictError'
  }
}

/**
 * Persists the multi-route wireframe document to `.annotask/wireframe.json`.
 * Modeled on createAgentConfigStore: no in-memory cache (the file is small and
 * may be edited or cleared externally — always read fresh so external edits and
 * the `.annotask/` watcher stay coherent), atomic tmp+rename writes.
 *
 * Writes are compare-and-set on `rev`: the caller must send back the rev it
 * last read; the store rejects a stale rev (WireframeRevConflictError) and
 * stamps `rev + 1` on success. Legacy docs without a rev accept one write
 * unconditionally — that write stamps the first rev.
 */
export function createWireframeStore(projectRoot: string) {
  const filePath = path.join(projectRoot, '.annotask', 'wireframe.json')

  async function load(): Promise<WireframeDocument> {
    try {
      const raw = JSON.parse(await fsp.readFile(filePath, 'utf-8'))
      return isWireframeDocument(raw) ? raw : emptyWireframeDocument()
    } catch {
      return emptyWireframeDocument()
    }
  }

  async function persist(doc: WireframeDocument): Promise<void> {
    const dir = path.dirname(filePath)
    await fsp.mkdir(dir, { recursive: true })
    const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`
    await fsp.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf-8')
    await fsp.rename(tmp, filePath)
  }

  return {
    get: load,
    set: async (doc: WireframeDocument): Promise<WireframeDocument> => {
      const current = await load()
      // CAS: only enforced once the on-disk doc carries a rev. A fresh/legacy
      // doc (no rev) accepts any write — including one without a rev — so old
      // shells aren't bricked; the write below stamps rev 1 and from then on
      // every writer must round-trip it.
      if (typeof current.rev === 'number' && doc.rev !== current.rev) {
        throw new WireframeRevConflictError(current.rev, doc.rev)
      }
      const stamped: WireframeDocument = { ...doc, rev: (current.rev ?? 0) + 1 }
      await persist(stamped)
      return stamped
    },
  }
}

export type WireframeStore = ReturnType<typeof createWireframeStore>
