/**
 * Shared task helpers used by the CLI, HTTP API, and MCP server.
 */

/**
 * Filter a task list by MFE. MFE-less tasks (e.g. page-wide perf/error/a11y
 * findings that aren't tied to a specific element) are always included so they
 * remain discoverable when an MFE filter is active.
 */
export function filterTasksByMfe<T extends { mfe?: unknown }>(tasks: T[], mfe: string): T[] {
  return tasks.filter(t => !t.mfe || t.mfe === mfe)
}
