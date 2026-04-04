import WebSocket from 'ws'
import { existsSync, mkdirSync, cpSync, readdirSync, symlinkSync, lstatSync, rmSync, readlinkSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const command = args[0] || 'watch'
const port = args.find(a => a.startsWith('--port='))?.split('=')[1] || '5173'
const host = args.find(a => a.startsWith('--host='))?.split('=')[1] || 'localhost'
const serverArg = args.find(a => a.startsWith('--server='))?.split('=')[1] || ''
const mfeArg = args.find(a => a.startsWith('--mfe='))?.split('=')[1] || ''
const prettyFlag = args.includes('--pretty')

/** Compact JSON for agent-facing output; strips null/undefined/empty arrays */
function fmt(data: unknown): string {
  if (prettyFlag) return JSON.stringify(data, null, 2)
  return JSON.stringify(data, (_key, value) => {
    if (value === null || value === undefined) return undefined
    if (Array.isArray(value) && value.length === 0) return undefined
    return value
  })
}

// Discover server URL and MFE from .annotask/server.json or CLI flags
let baseUrl = ''
let mfeFilter = mfeArg

try {
  const serverJson = JSON.parse(readFileSync('.annotask/server.json', 'utf-8'))
  baseUrl = serverArg || serverJson.url || ''
  if (!mfeFilter && serverJson.mfe) mfeFilter = serverJson.mfe
} catch {
  // No server.json found
}

if (!baseUrl) {
  baseUrl = serverArg || `http://${host}:${port}`
}

const wsUrl = baseUrl.replace(/^http/, 'ws') + '/__annotask/ws'
const apiUrl = baseUrl + '/__annotask/api'

// ── Skill targets ────────────────────────────────────

const KNOWN_TARGETS: Record<string, string> = {
  claude: '.claude/skills',
  agents: '.agents/skills',
  copilot: '.copilot/skills',
}

const DEFAULT_TARGETS = ['claude', 'agents']

function parseTargets(): string[] {
  const targetArg = args.find(a => a.startsWith('--target='))
  if (targetArg) {
    return targetArg.split('=')[1].split(',').map(t => t.trim())
  }
  return DEFAULT_TARGETS
}

// ── Commands ──────────────────────────────────────────

if (command === 'watch') {
  watchChanges()
} else if (command === 'report') {
  fetchReport()
} else if (command === 'status') {
  checkStatus()
} else if (command === 'init-skills') {
  initSkills()
} else if (command === 'screenshot') {
  fetchScreenshot()
} else if (command === 'tasks') {
  fetchTasks()
} else if (command === 'update-task') {
  updateTask()
} else if (command === 'components') {
  listComponents()
} else if (command === 'component') {
  showComponent()
} else if (command === 'mcp') {
  runMcpStdio()
} else if (command === 'help' || command === '--help') {
  printHelp()
} else {
  console.error(`Unknown command: ${command}`)
  printHelp()
  process.exit(1)
}

// ── Watch: live stream of changes via WebSocket ──────

const MAX_RETRIES = 20

function watchChanges() {
  let attempt = 0
  let ws: WebSocket | null = null

  function connect() {
    console.log(`\x1b[36m[Annotask]\x1b[0m ${attempt > 0 ? 'Reconnecting' : 'Connecting'} to ${wsUrl}...`)

    ws = new WebSocket(wsUrl)

    ws.on('open', () => {
      attempt = 0
      console.log(`\x1b[32m[Annotask]\x1b[0m Connected. Watching for changes...\n`)
    })

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())

        if (msg.event === 'report:updated' && msg.data) {
          const report = msg.data
          const count = report.changes?.length || 0
          console.log(`\x1b[33m── Report updated (${count} change${count === 1 ? '' : 's'}) ──\x1b[0m`)

          for (const change of report.changes || []) {
            const file = `\x1b[36m${change.file}:${change.line}\x1b[0m`
            const prop = `\x1b[33m${change.property}\x1b[0m`
            const before = `\x1b[31m${change.before || '(none)'}\x1b[0m`
            const after = `\x1b[32m${change.after}\x1b[0m`
            console.log(`  ${file}  ${prop}: ${before} → ${after}`)
          }
          console.log()
        }

        if (msg.event === 'report:current' && msg.data) {
          console.log(`\x1b[36m[Annotask]\x1b[0m Current report:`)
          console.log(JSON.stringify(msg.data, null, 2))
          console.log()
        }

        if (msg.event === 'changes:cleared') {
          console.log(`\x1b[36m[Annotask]\x1b[0m Changes cleared.\n`)
        }
      } catch {
        // ignore
      }
    })

    ws.on('close', () => {
      ws = null
      retry('Disconnected')
    })

    ws.on('error', (err) => {
      ws = null
      retry(`Connection failed: ${err.message}`)
    })
  }

  function retry(reason: string) {
    attempt++
    if (attempt > MAX_RETRIES) {
      console.error(`\x1b[31m[Annotask]\x1b[0m ${reason}. Giving up after ${MAX_RETRIES} retries.`)
      process.exit(1)
    }
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000)
    console.error(`\x1b[31m[Annotask]\x1b[0m ${reason}. Retrying in ${(delay / 1000).toFixed(0)}s (attempt ${attempt}/${MAX_RETRIES})...`)
    setTimeout(connect, delay)
  }

  connect()

  // Keep process alive
  process.on('SIGINT', () => {
    if (ws) ws.close()
    process.exit(0)
  })
}

// ── Report: fetch current report via HTTP ────────────

async function fetchReport() {
  try {
    const reportUrl = mfeFilter ? `${apiUrl}/report?mfe=${encodeURIComponent(mfeFilter)}` : `${apiUrl}/report`
    const res = await fetch(reportUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const report = await res.json()

    console.log(fmt(report))
    if (mfeFilter) {
      console.error(`\x1b[36m[Annotask]\x1b[0m Filtered by MFE: ${mfeFilter}`)
    }
  } catch (err: any) {
    console.error(`\x1b[31m[Annotask]\x1b[0m Failed to fetch report: ${err.message}`)
    console.error(`Make sure the Annotask server is running at ${baseUrl}`)
    process.exit(1)
  }
}

// ── Status: check if Annotask is running ───────────────

async function checkStatus() {
  try {
    const res = await fetch(`${apiUrl}/status`)
    const data = await res.json()
    console.log(`\x1b[32m[Annotask]\x1b[0m Server is running at ${baseUrl}`)
    if (mfeFilter) console.log(`\x1b[36m[Annotask]\x1b[0m MFE filter: ${mfeFilter}`)
    console.log(JSON.stringify(data, null, 2))
  } catch {
    console.log(`\x1b[31m[Annotask]\x1b[0m No Annotask server found at ${baseUrl}`)
    process.exit(1)
  }
}

// ── Screenshot: download a task's screenshot ─────────────

async function fetchScreenshot() {
  const taskId = args[1]
  if (!taskId) {
    console.error('\x1b[31m[Annotask]\x1b[0m Usage: annotask screenshot <task-id> [--output=path.png]')
    process.exit(1)
  }

  try {
    // Fetch tasks to find the screenshot filename
    const tasksRes = await fetch(`${apiUrl}/tasks`)
    const tasksData = await tasksRes.json()
    const task = tasksData.tasks.find((t: any) => t.id === taskId)
    if (!task) { console.error(`\x1b[31m[Annotask]\x1b[0m Task not found: ${taskId}`); process.exit(1) }
    if (!task.screenshot) { console.error(`\x1b[31m[Annotask]\x1b[0m Task has no screenshot`); process.exit(1) }

    // Download the screenshot
    const screenshotUrl = `${baseUrl}/__annotask/screenshots/${task.screenshot}`
    const res = await fetch(screenshotUrl)
    if (!res.ok) { console.error(`\x1b[31m[Annotask]\x1b[0m Screenshot not found: ${task.screenshot}`); process.exit(1) }
    const buffer = Buffer.from(await res.arrayBuffer())

    const outputArg = args.find(a => a.startsWith('--output='))
    const outputPath = outputArg ? outputArg.split('=')[1] : resolve('.annotask', 'screenshots', task.screenshot)

    const dir = dirname(outputPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const { writeFileSync } = await import('node:fs')
    writeFileSync(outputPath, buffer)
    console.log(`\x1b[32m[Annotask]\x1b[0m Screenshot saved to ${outputPath}`)
  } catch (err: any) {
    console.error(`\x1b[31m[Annotask]\x1b[0m Failed to fetch screenshot: ${err.message}`)
    process.exit(1)
  }
}

// ── Tasks: fetch task list ────────────────────────────────

const SUMMARY_FIELDS = ['id', 'type', 'status', 'description', 'file', 'line', 'component', 'action', 'screenshot', 'mfe', 'route', 'feedback', 'blocked_reason', 'resolution'] as const

async function fetchTasks() {
  try {
    const tasksUrl = mfeFilter ? `${apiUrl}/tasks?mfe=${encodeURIComponent(mfeFilter)}` : `${apiUrl}/tasks`
    const res = await fetch(tasksUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { tasks?: Array<Record<string, unknown>>; [key: string]: unknown }

    if (!prettyFlag) {
      const tasks = Array.isArray(data.tasks) ? data.tasks : []
      data.tasks = tasks.map((t) => {
        const summary: Record<string, unknown> = {}
        for (const key of SUMMARY_FIELDS) {
          if (t[key] !== undefined && t[key] !== null) summary[key] = t[key]
        }
        return summary
      })
      data.count = tasks.length
    }

    console.log(fmt(data))
  } catch (err: any) {
    console.error(`\x1b[31m[Annotask]\x1b[0m Failed to fetch tasks: ${err.message}`)
    process.exit(1)
  }
}

// ── Update Task: change task status ──────────────────────

async function updateTask() {
  const taskId = args[1]
  const statusArg = args.find(a => a.startsWith('--status='))?.split('=')[1]
  const feedbackArg = args.find(a => a.startsWith('--feedback='))?.split('=')[1]
  const askArg = args.find(a => a.startsWith('--ask='))?.split('=').slice(1).join('=')
  const blockedReasonArg = args.find(a => a.startsWith('--blocked-reason='))?.split('=').slice(1).join('=')
  const resolutionArg = args.find(a => a.startsWith('--resolution='))?.split('=').slice(1).join('=')

  if (!taskId || (!statusArg && !askArg && !blockedReasonArg)) {
    console.error('\x1b[31m[Annotask]\x1b[0m Usage: annotask update-task <task-id> --status=<status> [--feedback=<text>]')
    console.error('       annotask update-task <task-id> --ask=\'{"message":"...","questions":[...]}\'')
    console.error('       annotask update-task <task-id> --blocked-reason="Cannot fix: issue is in third-party library"')
    console.error('  Valid statuses: pending, in_progress, applied, review, accepted, denied, needs_info, blocked')
    process.exit(1)
  }

  try {
    const body: Record<string, unknown> = {}

    if (askArg) {
      // Fetch current task to get existing agent_feedback
      const taskRes = await fetch(`${apiUrl}/tasks`)
      const taskData = await taskRes.json()
      const task = taskData.tasks.find((t: any) => t.id === taskId)
      if (!task) { console.error(`\x1b[31m[Annotask]\x1b[0m Task not found: ${taskId}`); process.exit(1) }

      const askData = JSON.parse(askArg)
      const entry = {
        asked_at: Date.now(),
        message: askData.message,
        questions: askData.questions,
      }
      const thread = [...(task.agent_feedback || []), entry]
      body.agent_feedback = thread
      body.status = statusArg || 'needs_info'
    } else {
      body.status = statusArg
    }

    if (feedbackArg) body.feedback = feedbackArg
    if (blockedReasonArg) {
      body.blocked_reason = blockedReasonArg
      if (!body.status) body.status = 'blocked'
    }
    if (resolutionArg) body.resolution = resolutionArg

    const res = await fetch(`${apiUrl}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (data.error) {
      console.error(`\x1b[31m[Annotask]\x1b[0m ${data.error}`)
      process.exit(1)
    }
    console.log(fmt(data))
  } catch (err: any) {
    console.error(`\x1b[31m[Annotask]\x1b[0m Failed to update task: ${err.message}`)
    process.exit(1)
  }
}

// ── Init Skills: copy skills to project agent directories ──

function initSkills() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const srcSkills = resolve(__dirname, '..', 'skills')
  const force = args.includes('--force')
  const targets = parseTargets()

  if (!existsSync(srcSkills)) {
    console.error(`\x1b[31m[Annotask]\x1b[0m Skills directory not found in package. Expected: ${srcSkills}`)
    process.exit(1)
  }

  const skillNames = readdirSync(srcSkills).filter(name =>
    existsSync(resolve(srcSkills, name, 'SKILL.md'))
  )

  if (skillNames.length === 0) {
    console.error(`\x1b[31m[Annotask]\x1b[0m No skills found in ${srcSkills}`)
    process.exit(1)
  }

  // Resolve target paths — known names map to dotfile dirs, anything else is used as-is
  const targetPaths = targets.map(t => ({
    name: t,
    dir: resolve(process.cwd(), KNOWN_TARGETS[t] || t),
  }))

  // First target gets real files, subsequent targets get symlinks back to the first
  const primary = targetPaths[0]
  const secondaries = targetPaths.slice(1)

  // ── Install real files to primary target ──
  mkdirSync(primary.dir, { recursive: true })
  let installed = 0
  let skipped = 0

  for (const skill of skillNames) {
    const dest = resolve(primary.dir, skill)
    if (existsSync(dest) && !isSymlink(dest)) {
      if (force) {
        cpSync(resolve(srcSkills, skill), dest, { recursive: true })
        installed++
      } else {
        console.log(`  \x1b[33mskip\x1b[0m  ${skill} → ${primary.name} (already exists)`)
        skipped++
      }
    } else {
      if (isSymlink(dest)) rmSync(dest, { recursive: true })
      cpSync(resolve(srcSkills, skill), dest, { recursive: true })
      installed++
    }
  }

  console.log(`\x1b[32m[Annotask]\x1b[0m ${primary.name}: ${installed} installed, ${skipped} skipped`)

  // ── Symlink secondary targets to primary ──
  for (const target of secondaries) {
    mkdirSync(target.dir, { recursive: true })
    let linked = 0
    let linkSkipped = 0

    for (const skill of skillNames) {
      const dest = resolve(target.dir, skill)
      const linkTarget = relative(target.dir, resolve(primary.dir, skill))

      if (existsSync(dest)) {
        if (isSymlink(dest)) {
          // Already a symlink — check if it points to the right place
          const existing = readlinkSync(dest)
          if (existing === linkTarget && !force) {
            linkSkipped++
            continue
          }
          rmSync(dest)
        } else if (force) {
          rmSync(dest, { recursive: true })
        } else {
          console.log(`  \x1b[33mskip\x1b[0m  ${skill} → ${target.name} (already exists, not a symlink)`)
          linkSkipped++
          continue
        }
      }

      symlinkSync(linkTarget, dest, 'dir')
      linked++
    }

    console.log(`\x1b[32m[Annotask]\x1b[0m ${target.name}: ${linked} linked → ${primary.name}, ${linkSkipped} skipped`)
  }

  // ── Summary ──
  console.log()
  for (const skill of skillNames) {
    console.log(`  \x1b[32m✓\x1b[0m /${skill}`)
  }

  if (secondaries.length > 0) {
    console.log(`\n  Files in \x1b[36m${KNOWN_TARGETS[primary.name] || primary.name}\x1b[0m, symlinked from ${secondaries.map(t => `\x1b[36m${KNOWN_TARGETS[t.name] || t.name}\x1b[0m`).join(', ')}`)
  }
}

function isSymlink(p: string): boolean {
  try { return lstatSync(p).isSymbolicLink() } catch { return false }
}

// ── Components: list available component libraries ───

async function listComponents() {
  try {
    const res = await fetch(`${apiUrl}/components`)
    const data = await res.json()
    const filterArg = args[1] || ''

    for (const lib of data.libraries || []) {
      const components = filterArg
        ? lib.components.filter((c: any) => c.name.toLowerCase().includes(filterArg.toLowerCase()))
        : lib.components

      if (components.length === 0) continue

      console.log(`\n\x1b[36m${lib.name}\x1b[0m v${lib.version} (${components.length} components)`)
      for (const comp of components) {
        const propCount = comp.props?.length || 0
        console.log(`  \x1b[33m${comp.name}\x1b[0m  ${comp.module}  (${propCount} props)`)
      }
    }
  } catch (err: any) {
    console.error(`\x1b[31m[Annotask]\x1b[0m Failed to fetch components: ${err.message}`)
    process.exit(1)
  }
}

// ── Component: show detailed info for one component ──

async function showComponent() {
  const name = args[1]
  if (!name) {
    console.error('\x1b[31m[Annotask]\x1b[0m Usage: annotask component <ComponentName>')
    process.exit(1)
  }

  const jsonFlag = args.includes('--json')

  try {
    const res = await fetch(`${apiUrl}/components`)
    const data = await res.json()

    let found: any = null
    let libName = ''
    for (const lib of data.libraries || []) {
      const match = lib.components.find((c: any) => c.name.toLowerCase() === name.toLowerCase())
      if (match) { found = match; libName = lib.name; break }
    }

    if (!found) {
      console.error(`\x1b[31m[Annotask]\x1b[0m Component "${name}" not found. Use \x1b[33mannotask components\x1b[0m to list available components.`)
      process.exit(1)
    }

    if (jsonFlag) {
      console.log(JSON.stringify({ library: libName, ...found }, null, 2))
      return
    }

    console.log(`\n\x1b[36m${found.name}\x1b[0m`)
    console.log(`  Library: ${libName}`)
    console.log(`  Import:  ${found.module}`)

    if (found.props.length === 0) {
      console.log('  Props:   none')
    } else {
      console.log(`  Props:   ${found.props.length}\n`)
      for (const p of found.props) {
        const req = p.required ? ' \x1b[33m(required)\x1b[0m' : ''
        const type = p.type ? `\x1b[90m${p.type}\x1b[0m` : ''
        const def = p.default != null ? `  default: ${p.default}` : ''
        console.log(`  \x1b[36m${p.name}\x1b[0m  ${type}${req}${def}`)
        if (p.description) console.log(`    ${p.description}`)
      }
    }
  } catch (err: any) {
    console.error(`\x1b[31m[Annotask]\x1b[0m Failed to fetch component: ${err.message}`)
    process.exit(1)
  }
}

// ── MCP: stdio transport (proxies to HTTP MCP endpoint) ──

import { createInterface } from 'node:readline'

function runMcpStdio() {
  const mcpUrl = baseUrl + '/__annotask/mcp'
  const pending = new Set<Promise<void>>()
  let stdinClosed = false

  const rl = createInterface({ input: process.stdin, terminal: false })

  rl.on('line', (line) => {
    if (!line.trim()) return

    const p = (async () => {
      try {
        const response = await fetch(mcpUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: line,
        })

        // Notifications get 202 with no body
        if (response.status === 202) return

        const body = await response.text()
        if (body) process.stdout.write(body + '\n')
      } catch (err: any) {
        // Try to extract request id for error response
        let id: string | number | null = null
        try { id = JSON.parse(line).id ?? null } catch {}
        if (id !== null && id !== undefined) {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: `Transport error: ${err.message}` },
            id,
          }) + '\n')
        }
      }
    })()

    pending.add(p)
    p.finally(() => {
      pending.delete(p)
      if (stdinClosed && pending.size === 0) process.exit(0)
    })
  })

  rl.on('close', () => {
    stdinClosed = true
    if (pending.size === 0) process.exit(0)
  })

  process.on('SIGINT', () => process.exit(0))
}

// ── Help ─────────────────────────────────────────────

function printHelp() {
  console.log(`
\x1b[36mAnnotask CLI\x1b[0m — interact with Annotask design tool from the terminal

\x1b[33mUsage:\x1b[0m
  annotask <command> [options]

\x1b[33mCommands:\x1b[0m
  watch           Live stream of design changes (default)
  tasks           Fetch task list (compact summaries by default)
  report          Fetch the live change report (no tasks)
  status          Check if Annotask server is running
  components      List all available component library components
  component       Show detailed props for a specific component
  init-skills     Install AI agent skills to your project
  mcp             Start MCP server (stdio transport, proxies to dev server)
  help            Show this help

\x1b[33mOptions:\x1b[0m
  --port=N          Dev server port (default: 5173)
  --host=H          Dev server host (default: localhost)
  --server=URL      Annotask server URL (overrides .annotask/server.json)
  --mfe=NAME        Filter tasks by MFE identity (overrides server.json mfe)
  --pretty          Pretty-print JSON output (default: compact for agents)
  --force           Overwrite existing skills (for init-skills)
  --target=NAME     Comma-separated targets (default: claude,agents)
                    Built-in: claude, agents, copilot
                    Custom: --target=.my-tool/skills

\x1b[33mExamples:\x1b[0m
  annotask tasks                          # Compact task summaries
  annotask tasks --pretty                 # Full task objects, pretty-printed
  annotask watch                          # Watch live changes
  annotask report                         # Get live change report
  annotask components                     # List all library components
  annotask components Button              # Filter by name
  annotask component Button               # Show Button props
  annotask component Button --json        # Props as JSON (for LLMs)
  annotask status                         # Check connection
  annotask init-skills                    # Install AI agent skills
  annotask mcp                            # Start stdio MCP server
`)
}
