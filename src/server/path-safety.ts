/**
 * Shared path-traversal guard. Every endpoint that reads a file from a
 * user-supplied path must run the value through `resolveProjectFile` first —
 * otherwise `../../etc/passwd` (or task.file populated by a malicious page)
 * escapes the containment root.
 *
 * Containment root selection:
 *   - When a `workspaceRoot` is supplied (pnpm / npm / yarn / lerna monorepo
 *     root discovered by `resolveWorkspace`), the resolved absolute path must
 *     stay under the workspace. This is what lets tasks in one MFE reference
 *     sibling packages like `../../packages/shared-ui-tokens/tokens.css`.
 *   - Otherwise (single-package projects, or callers that haven't wired the
 *     workspace through yet), containment falls back to `projectRoot`, which
 *     is the pre-workspace-aware behavior.
 *
 * The returned `relative` is always relative to `projectRoot`, so a
 * workspace-sibling file surfaces as `../../packages/…`. Callers that print
 * or persist the path see the same shape whether or not workspace awareness
 * was plumbed through — only the containment check broadens.
 *
 * The screenshot endpoint uses the same `resolve() + startsWith(root + sep)`
 * pattern (see src/server/api.ts); this centralizes that logic.
 */
import nodePath from 'node:path'

export interface ResolvedProjectFile {
  absolutePath: string
  /** Always forward-slashed, relative to `projectRoot`. May start with `../`
   *  when the file lives in a sibling workspace package. */
  relative: string
}

/**
 * Reject anything that escapes the containment root, is empty after
 * normalization, or uses an absolute path we have no business reading.
 * Returns `null` on any rejection — callers should respond 400.
 *
 * Accepts:
 *   - "src/components/Foo.vue"
 *   - "./src/components/Foo.vue"
 *   - "/src/components/Foo.vue"  (leading slash stripped — tolerant of old clients)
 *   - "../../packages/shared/tokens.css"  (only when workspaceRoot is supplied
 *     and the resolved path stays under it)
 *
 * Rejects:
 *   - "/etc/passwd" — resolves outside both the project and workspace roots.
 *   - Windows drive letters, UNC paths, URL-looking inputs, null bytes.
 */
export function resolveProjectFile(
  projectRoot: string,
  relFile: unknown,
  workspaceRoot?: string,
): ResolvedProjectFile | null {
  if (typeof relFile !== 'string') return null
  if (relFile.length === 0) return null
  if (relFile.includes('\0')) return null
  // Disallow Windows drive letters / UNC paths / URL-looking inputs outright.
  if (/^[a-zA-Z]:[\\/]/.test(relFile)) return null
  if (/^\\\\/.test(relFile)) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(relFile)) return null

  const projectAbs = nodePath.resolve(projectRoot)
  const stripped = relFile.replace(/^\/+/, '')
  const abs = nodePath.resolve(projectAbs, stripped)

  // Pick the containment root. Workspace root must be an ancestor of (or
  // equal to) projectRoot for this to make sense; fall back to projectRoot
  // if the caller passed something narrower by mistake.
  let containment = projectAbs
  if (workspaceRoot) {
    const wsAbs = nodePath.resolve(workspaceRoot)
    const projectWithSep = projectAbs.endsWith(nodePath.sep) ? projectAbs : projectAbs + nodePath.sep
    if (wsAbs === projectAbs || projectWithSep.startsWith(wsAbs.endsWith(nodePath.sep) ? wsAbs : wsAbs + nodePath.sep)) {
      containment = wsAbs
    }
  }

  // startsWith(root + sep) is the canonical containment check. We also disallow
  // `abs === containment` (can't read a directory as a file).
  if (abs === containment) return null
  const containmentWithSep = containment.endsWith(nodePath.sep) ? containment : containment + nodePath.sep
  if (!abs.startsWith(containmentWithSep)) return null

  const relative = nodePath.relative(projectAbs, abs).replace(/\\/g, '/')
  return { absolutePath: abs, relative }
}

/** `resolveProjectFile` variant for contexts that want a thrown error. */
export function assertProjectFile(
  projectRoot: string,
  relFile: unknown,
  workspaceRoot?: string,
): ResolvedProjectFile {
  const r = resolveProjectFile(projectRoot, relFile, workspaceRoot)
  if (!r) throw new Error(`Invalid or escaping file path: ${String(relFile)}`)
  return r
}
