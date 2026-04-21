import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')
const CLI_ENTRY = join(REPO_ROOT, 'dist', 'cli.js')

export interface TaskSummary {
  id: string
  type: string
  status: string
  description: string
  file?: string
  line?: number
  route?: string
  mfe?: string
  [key: string]: unknown
}

function runCli(args: string[]): string {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(`annotask CLI not built at ${CLI_ENTRY} — run 'pnpm build' first`)
  }
  try {
    return execFileSync('node', [CLI_ENTRY, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`annotask CLI failed: ${msg}`)
  }
}

export function listTasks(port: number, opts: { status?: string; mfe?: string } = {}): TaskSummary[] {
  const args = ['tasks', '--mcp', `--server=http://localhost:${port}`]
  if (opts.status) args.push(`--status=${opts.status}`)
  if (opts.mfe) args.push(`--mfe=${opts.mfe}`)
  const out = runCli(args)
  const parsed = JSON.parse(out)
  return Array.isArray(parsed) ? parsed : parsed.tasks || []
}

export function getTask(port: number, id: string): TaskSummary & { context?: unknown } {
  const out = runCli(['task', id, '--mcp', `--server=http://localhost:${port}`])
  return JSON.parse(out)
}
