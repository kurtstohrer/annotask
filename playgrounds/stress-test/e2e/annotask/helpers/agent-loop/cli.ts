/**
 * Thin wrappers around the bundled annotask CLI that match the MCP
 * tool sequence in `skills/annotask-apply/SKILL.md`. Tests should
 * prefer these over hand-rolling HTTP calls so we exercise the same
 * CLI surface a real agent would use.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const CLI_ENTRY = join(REPO_ROOT, 'dist', 'cli.js')

function runCli(args: string[]): string {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(`annotask CLI not built at ${CLI_ENTRY} — run 'pnpm build' first`)
  }
  try {
    return execFileSync('node', [CLI_ENTRY, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`annotask CLI failed (${args.join(' ')}): ${msg}`)
  }
}

export function getTask(port: number, id: string): Record<string, unknown> {
  const out = runCli(['task', id, '--mcp', `--server=http://localhost:${port}`])
  return JSON.parse(out) as Record<string, unknown>
}

export function listTasks(port: number, status?: string): Array<Record<string, unknown>> {
  const args = ['tasks', '--mcp', `--server=http://localhost:${port}`]
  if (status) args.push(`--status=${status}`)
  const parsed = JSON.parse(runCli(args))
  return Array.isArray(parsed) ? parsed : (parsed.tasks ?? [])
}

export function updateTaskStatus(
  port: number,
  id: string,
  status: string,
  resolution?: string,
): Record<string, unknown> {
  const args = [
    'update-task',
    id,
    '--mcp',
    `--server=http://localhost:${port}`,
    `--status=${status}`,
  ]
  if (resolution) args.push(`--resolution=${resolution}`)
  const out = runCli(args)
  return JSON.parse(out) as Record<string, unknown>
}
