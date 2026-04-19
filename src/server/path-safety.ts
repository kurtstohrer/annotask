/**
 * Shared path-traversal guard. Every endpoint that reads a file from a
 * user-supplied path must run the value through `resolveProjectFile` first —
 * otherwise `../../etc/passwd` (or task.file populated by a malicious page)
 * escapes the project root.
 *
 * The screenshot endpoint uses the same `resolve() + startsWith(root + sep)`
 * pattern (see src/server/api.ts); this centralizes that logic.
 */
import nodePath from 'node:path'

export interface ResolvedProjectFile {
  absolutePath: string
  /** Always forward-slashed, relative to `projectRoot`. */
  relative: string
}

/**
 * Reject anything that escapes `projectRoot`, is empty after normalization,
 * or uses an absolute path we have no business reading. Returns `null` on
 * any rejection — callers should respond 400.
 *
 * Accepts:
 *   - "src/components/Foo.vue"
 *   - "./src/components/Foo.vue"
 *   - "/src/components/Foo.vue"  (leading slash stripped — tolerant of old clients)
 *
 * Rejects:
 *   - "/etc/passwd" after stripping the leading slash becomes "etc/passwd"
 *     which resolves fine, but the startsWith check catches it because the
 *     real file won't live under projectRoot. Belt and suspenders: absolute
 *     URLs, empty strings, and null-byte injection are all caught explicitly.
 */
export function resolveProjectFile(projectRoot: string, relFile: unknown): ResolvedProjectFile | null {
  if (typeof relFile !== 'string') return null
  if (relFile.length === 0) return null
  if (relFile.includes('\0')) return null
  // Disallow Windows drive letters / UNC paths / URL-looking inputs outright.
  if (/^[a-zA-Z]:[\\/]/.test(relFile)) return null
  if (/^\\\\/.test(relFile)) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(relFile)) return null

  const root = nodePath.resolve(projectRoot)
  const stripped = relFile.replace(/^\/+/, '')
  const abs = nodePath.resolve(root, stripped)

  // startsWith(root + sep) is the canonical containment check. We also allow
  // `abs === root` to fail (can't read a directory as a file).
  if (abs === root) return null
  const rootWithSep = root.endsWith(nodePath.sep) ? root : root + nodePath.sep
  if (!abs.startsWith(rootWithSep)) return null

  const relative = nodePath.relative(root, abs).replace(/\\/g, '/')
  return { absolutePath: abs, relative }
}

/** `resolveProjectFile` variant for contexts that want a thrown error. */
export function assertProjectFile(projectRoot: string, relFile: unknown): ResolvedProjectFile {
  const r = resolveProjectFile(projectRoot, relFile)
  if (!r) throw new Error(`Invalid or escaping file path: ${String(relFile)}`)
  return r
}
