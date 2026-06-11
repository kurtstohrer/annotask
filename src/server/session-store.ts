import path from 'node:path'
import { createJsonCasStore, RevConflictError } from './json-cas-store.js'
import {
  emptyDesignSessionDocument,
  isDesignSessionDocument,
  type DesignSessionDocument,
} from '../shared/design-session-types.js'

export { RevConflictError }

/**
 * Persists the design-session journal to `.annotask/design-session.json` —
 * the ordered record of what the user did in the design tool (element edits +
 * placement cross-references). The shell owns the in-memory journal and PUTs
 * the whole document (small, single-writer file, CAS on `rev`); the server
 * owns discard and the task-lifecycle mutations.
 */
export function createSessionStore(projectRoot: string) {
  // The empty doc needs a session id; mint one per store so repeated GETs of a
  // missing file agree with each other until the first write adopts the
  // shell's id.
  const fallbackId = `ds-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  return createJsonCasStore<DesignSessionDocument>(
    path.join(projectRoot, '.annotask', 'design-session.json'),
    {
      validate: isDesignSessionDocument,
      empty: () => emptyDesignSessionDocument(fallbackId),
      label: 'Design session',
    },
  )
}

export type SessionStore = ReturnType<typeof createSessionStore>
