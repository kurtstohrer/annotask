import WebSocket from 'ws'
import { existsSync, mkdirSync, cpSync, readdirSync, symlinkSync, lstatSync, rmSync, readlinkSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTaskSummary, stripTaskVisual, trimAgentFeedback, compactJson } from '../shared/task-summary.js'

const args = process.argv.slice(2)
const command = args[0] || 'watch'
const portArg = args.find(a => a.startsWith('--port='))?.split('=')[1] || ''
const hostArg = args.find(a => a.startsWith('--host='))?.split('=')[1] || ''
const serverArg = args.find(a => a.startsWith('--server='))?.split('=')[1] || ''
const mfeArg = args.find(a => a.startsWith('--mfe='))?.split('=')[1] || ''
const prettyFlag = args.includes('--pretty')
const detailFlag = args.includes('--detail')
/**
 * --mcp forces agent-parity output: compact JSON on stdout, no ANSI colors,
 * no human-readable prefixes. The shape matches what the MCP server returns
 * for the equivalent `annotask_*` tool call, so skills that prefer MCP can
 * fall back to CLI invocations with identical parsing. Overrides --pretty.
 */
const mcpFlag = args.includes('--mcp')

/** Compact JSON for agent-facing output; strips null/undefined/empty arrays */
function fmt(data: unknown): string {
  if (prettyFlag && !mcpFlag) return JSON.stringify(data, null, 2)
  return compactJson(data)
}

/** Color wrapper — returns raw text under --mcp so stderr/stdout stay parseable. */
function color(code: string, text: string): string {
  return mcpFlag ? text : `\x1b[${code}m${text}\x1b[0m`
}
/** stderr log that's suppressed under --mcp (keeps tool output machine-clean). */
function info(text: string): void {
  if (!mcpFlag) console.error(text)
}

/**
 * Discover the dev-server URL.
 *
 * Precedence: `--server=` flag → `.annotask/server.json` → `--port`/`--host`
 * flags → hard fallback. `source` tells us which branch ran so error messages
 * can tell the agent what to fix (cd into the MFE, start the dev server, etc.)
 * instead of printing a misleading default URL.
 */
type BaseUrlSource = 'flag' | 'server-json' | 'port-flag' | 'fallback'

function discoverBaseUrl(): { url: string; source: BaseUrlSource; mfe?: string } {
  if (serverArg) return { url: serverArg, source: 'flag' }

  try {
    const raw = readFileSync('.annotask/server.json', 'utf-8')
    const serverJson = JSON.parse(raw)
    if (serverJson.url) {
      return { url: serverJson.url, source: 'server-json', mfe: serverJson.mfe }
    }
  } catch {
    // fall through to port-flag / fallback
  }

  if (portArg || hostArg) {
    return { url: `http://${hostArg || 'localhost'}:${portArg || '5173'}`, source: 'port-flag' }
  }

  return { url: 'http://localhost:5173', source: 'fallback' }
}

const discovered = discoverBaseUrl()
const baseUrl = discovered.url
const baseUrlSource = discovered.source
let mfeFilter = mfeArg
if (!mfeFilter && discovered.mfe) mfeFilter = discovered.mfe

const wsUrl = baseUrl.replace(/^http/, 'ws') + '/__annotask/ws'
const apiUrl = baseUrl + '/__annotask/api'

/** Human-readable hint for the agent when a connection fails. */
function serverHint(): string {
  if (baseUrlSource === 'server-json' || baseUrlSource === 'flag') {
    return `Server is configured at ${baseUrl} but isn't responding — is the dev server still running?`
  }
  const cwd = process.cwd()
  return [
    `No .annotask/server.json found in ${cwd}.`,
    `Either cd into the MFE directory that owns the dev server, or start it first.`,
    `(Falling back to ${baseUrl} — this is almost certainly wrong.)`,
  ].join(' ')
}

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
} else if (command === 'init-mcp') {
  initMcp()
} else if (command === 'screenshot') {
  fetchScreenshot()
} else if (command === 'tasks') {
  fetchTasks()
} else if (command === 'task') {
  fetchTask()
} else if (command === 'design-spec') {
  fetchDesignSpec()
} else if (command === 'update-task') {
  updateTask()
} else if (command === 'components') {
  listComponents()
} else if (command === 'component') {
  showComponent()
} else if (command === 'code-context') {
  fetchCodeContext()
} else if (command === 'component-examples') {
  fetchComponentExamples()
} else if (command === 'data-context') {
  fetchDataContext()
} else if (command === 'interaction-history') {
  fetchInteractionHistory()
} else if (command === 'rendered-html') {
  fetchRenderedHtml()
} else if (command === 'data-sources') {
  fetchDataSources()
} else if (command === 'data-source-examples') {
  fetchDataSourceExamples()
} else if (command === 'data-source-details') {
  fetchDataSourceDetails()
} else if (command === 'api-schemas') {
  fetchApiSchemas()
} else if (command === 'api-operation') {
  fetchApiOperation()
} else if (command === 'resolve-endpoint') {
  resolveEndpointCmd()
} else if (command === 'runtime-endpoints') {
  fetchRuntimeEndpoints()
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
    if (mfeFilter) info(`${color('36', '[Annotask]')} Filtered by MFE: ${mfeFilter}`)
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch report: ${err.message}`)
    if (!mcpFlag) console.error(serverHint())
    process.exit(1)
  }
}

// ── Status: check if Annotask is running ───────────────

async function checkStatus() {
  try {
    const res = await fetch(`${apiUrl}/status`)
    const data = await res.json() as Record<string, unknown>
    if (mcpFlag) {
      console.log(fmt({ ...data, url: baseUrl, mfe: mfeFilter || undefined, source: baseUrlSource }))
      return
    }
    console.log(`${color('32', '[Annotask]')} Server is running at ${baseUrl} (${baseUrlSource})`)
    if (mfeFilter) console.log(`${color('36', '[Annotask]')} MFE filter: ${mfeFilter}`)
    console.log(JSON.stringify(data, null, 2))
  } catch {
    if (mcpFlag) {
      console.log(fmt({ status: 'unreachable', url: baseUrl, source: baseUrlSource, hint: serverHint() }))
      process.exit(1)
    }
    console.log(`${color('31', '[Annotask]')} No Annotask server found at ${baseUrl}`)
    console.log(serverHint())
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

    writeFileSync(outputPath, buffer)
    console.log(`\x1b[32m[Annotask]\x1b[0m Screenshot saved to ${outputPath}`)
  } catch (err: any) {
    console.error(`\x1b[31m[Annotask]\x1b[0m Failed to fetch screenshot: ${err.message}`)
    process.exit(1)
  }
}

// ── Tasks: fetch task list ────────────────────────────────

async function fetchTasks() {
  const statusFilter = args.find(a => a.startsWith('--status='))?.split('=')[1] || ''
  try {
    const tasksUrl = mfeFilter ? `${apiUrl}/tasks?mfe=${encodeURIComponent(mfeFilter)}` : `${apiUrl}/tasks`
    const res = await fetch(tasksUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { tasks?: Array<Record<string, unknown>>; [key: string]: unknown }

    let tasks = Array.isArray(data.tasks) ? data.tasks : []
    if (statusFilter) tasks = tasks.filter(t => t.status === statusFilter)

    // With --detail (or legacy --pretty without --mcp) we return full task
    // objects. In MCP-parity mode we strip the shell-only `visual` field so
    // the shape matches annotask_get_tasks(detail:true).
    if (detailFlag) {
      data.tasks = mcpFlag ? tasks.map(stripTaskVisual) : tasks
    } else if (prettyFlag && !mcpFlag) {
      data.tasks = tasks
    } else {
      data.tasks = tasks.map(buildTaskSummary)
    }
    data.count = (data.tasks as unknown[]).length

    console.log(fmt(data))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch tasks: ${err.message}`)
    process.exit(1)
  }
}

// ── Task: fetch a single task (matches MCP annotask_get_task) ────

async function fetchTask() {
  const taskId = args[1]
  if (!taskId) {
    console.error(`${color('31', '[Annotask]')} Usage: annotask task <task-id>`)
    process.exit(1)
  }
  try {
    const res = await fetch(`${apiUrl}/tasks/${encodeURIComponent(taskId)}`)
    if (res.status === 404) {
      console.error(`${color('31', '[Annotask]')} Task not found: ${taskId}`)
      process.exit(1)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const task = await res.json() as Record<string, unknown>
    console.log(fmt(trimAgentFeedback(stripTaskVisual(task))))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch task: ${err.message}`)
    process.exit(1)
  }
}

// ── Design spec: summary or sliced category (matches MCP) ────────

async function fetchDesignSpec() {
  const categoryArg = args.find(a => a.startsWith('--category='))?.split('=')[1] || ''
  try {
    const res = await fetch(`${apiUrl}/design-spec`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const spec = await res.json() as Record<string, any> | null
    if (!spec) { console.log(fmt({ initialized: false })); return }

    if (categoryArg) {
      const slice: Record<string, unknown> = { version: spec.version, framework: spec.framework }
      if (categoryArg !== 'framework') {
        if (!(categoryArg in spec)) {
          console.error(`${color('31', '[Annotask]')} Unknown category: ${categoryArg}`)
          process.exit(1)
        }
        slice[categoryArg] = spec[categoryArg]
      }
      console.log(fmt(slice))
      return
    }

    // Summary mode — token counts instead of the full payload, matches the
    // shape annotask_get_design_spec returns without a `category` arg.
    const summary = {
      version: spec.version,
      framework: spec.framework,
      counts: {
        colors: spec.colors?.length ?? 0,
        typographyFamilies: spec.typography?.families?.length ?? 0,
        typographyScale: spec.typography?.scale?.length ?? 0,
        spacing: spec.spacing?.length ?? 0,
        borderRadius: spec.borders?.radius?.length ?? 0,
      },
      hasBreakpoints: !!spec.breakpoints && Object.keys(spec.breakpoints).length > 0,
      icons: spec.icons ? { library: spec.icons.library } : null,
      components: spec.components ? { library: spec.components.library, used: spec.components.used?.length ?? 0 } : null,
    }
    console.log(fmt(summary))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch design spec: ${err.message}`)
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
    console.error(`${color('31', '[Annotask]')} Usage: annotask update-task <task-id> --status=<status> [--feedback=<text>]`)
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
      if (!task) { console.error(`${color('31', '[Annotask]')} Task not found: ${taskId}`); process.exit(1) }

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
      const msg = typeof data.error === 'string' ? data.error : data.error.message ?? 'Unknown error'
      console.error(`${color('31', '[Annotask]')} ${msg}`)
      process.exit(1)
    }
    console.log(fmt(mcpFlag ? stripTaskVisual(data) : data))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to update task: ${err.message}`)
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

// ── Init MCP: write editor-specific MCP config files ──

function initMcp() {
  /**
   * Config layouts we know how to write. Each target describes the file we land
   * on disk, the wrapper key (`mcpServers` vs. VS Code's `servers`), and the
   * hint we print on success.
   *
   * Cursor / Windsurf both use the widely-adopted `mcpServers` shape; VS Code
   * uses `servers` instead. Claude Code reads `.mcp.json` at the project root.
   *
   * Declared inside the function so the const is fully initialized before
   * anything in the function body reads it — putting it at module scope while
   * `initMcp` is dispatched from a top-level `if` block triggers a TDZ error
   * because the dispatch runs before the const initializer.
   */
  const MCP_EDITORS: Record<string, { name: string; path: string; key: 'mcpServers' | 'servers'; hint: string }> = {
    claude:   { name: 'Claude Code', path: '.mcp.json',                          key: 'mcpServers', hint: 'Restart Claude Code to pick up the new server.' },
    cursor:   { name: 'Cursor',      path: '.cursor/mcp.json',                   key: 'mcpServers', hint: 'Enable the server in Cursor Settings → MCP.' },
    vscode:   { name: 'VS Code',     path: '.vscode/mcp.json',                   key: 'servers',    hint: 'Open the MCP panel in VS Code and start the server.' },
    windsurf: { name: 'Windsurf',    path: '.codeium/windsurf/mcp_config.json',  key: 'mcpServers', hint: 'Open Windsurf → MCP settings and refresh.' },
  }

  const editorArg = args.find(a => a.startsWith('--editor='))?.split('=')[1] || 'claude'
  const transportArg = args.find(a => a.startsWith('--transport='))?.split('=')[1] || 'stdio'
  const force = args.includes('--force')

  if (transportArg !== 'stdio' && transportArg !== 'http') {
    console.error(`\x1b[31m[Annotask]\x1b[0m Unknown --transport=${transportArg}. Valid: stdio, http`)
    process.exit(1)
  }

  /**
   * Default transport is stdio: `npx annotask mcp` resolves the dev-server URL
   * from `.annotask/server.json` per request, so port changes don't leave the
   * MCP config stale. HTTP transport hardcodes the URL and is offered as an
   * opt-in for users who prefer it (e.g. editors without stdio support).
   */
  const annotaskEntry = transportArg === 'http'
    ? { type: 'http', url: baseUrl + '/__annotask/mcp' }
    : { command: 'npx', args: ['annotask', 'mcp'] }

  const targetKeys = editorArg === 'all' ? Object.keys(MCP_EDITORS) : editorArg.split(',').map(s => s.trim())
  const unknown = targetKeys.filter(k => !MCP_EDITORS[k])
  if (unknown.length > 0) {
    console.error(`\x1b[31m[Annotask]\x1b[0m Unknown editor(s): ${unknown.join(', ')}. Valid: ${Object.keys(MCP_EDITORS).join(', ')}, all`)
    process.exit(1)
  }

  let written = 0
  let skipped = 0

  for (const key of targetKeys) {
    const target = MCP_EDITORS[key]
    const filePath = resolve(process.cwd(), target.path)
    const parent = dirname(filePath)

    // Merge with any existing config so we don't clobber other servers the user
    // already configured (e.g. they've got a Linear MCP alongside).
    let existing: Record<string, unknown> = {}
    const exists = existsSync(filePath)
    if (exists) {
      try {
        existing = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
      } catch {
        if (!force) {
          console.log(`  \x1b[33mskip\x1b[0m  ${target.name} → ${target.path} (file exists and isn't valid JSON; use --force to overwrite)`)
          skipped++
          continue
        }
        existing = {}
      }
    }

    const wrapper = (existing[target.key] && typeof existing[target.key] === 'object' && !Array.isArray(existing[target.key]))
      ? existing[target.key] as Record<string, unknown>
      : {}

    if (wrapper.annotask && !force) {
      console.log(`  \x1b[33mskip\x1b[0m  ${target.name} → ${target.path} (annotask entry already present; use --force to overwrite)`)
      skipped++
      continue
    }

    wrapper.annotask = annotaskEntry
    existing[target.key] = wrapper

    if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
    writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8')
    console.log(`  \x1b[32m${exists ? 'merge' : 'write'}\x1b[0m ${target.name} → \x1b[36m${target.path}\x1b[0m`)
    console.log(`         ${target.hint}`)
    written++
  }

  console.log()
  console.log(`\x1b[32m[Annotask]\x1b[0m MCP config: ${written} written, ${skipped} skipped`)
  if (transportArg === 'http') {
    console.log(`  Transport: \x1b[36mhttp\x1b[0m → \x1b[36m${baseUrl}/__annotask/mcp\x1b[0m`)
    console.log(`  Note: URL is static. Restart editor after changing dev-server port.`)
  } else {
    console.log(`  Transport: \x1b[36mstdio\x1b[0m (\x1b[36mnpx annotask mcp\x1b[0m)`)
    console.log(`  Resolves the dev-server port from .annotask/server.json per request.`)
  }
  console.log(`  Make sure the Annotask dev server is running before your editor connects.`)
}

// ── Components: list available component libraries ───

async function listComponents() {
  const libraryArg = args.find(a => a.startsWith('--library='))?.split('=')[1] || ''
  const categoryArg = args.find(a => a.startsWith('--category='))?.split('=')[1] || ''
  const limitArg = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1]) || 50
  const offsetArg = Number(args.find(a => a.startsWith('--offset='))?.split('=')[1]) || 0

  try {
    const res = await fetch(`${apiUrl}/components`)
    const data = await res.json()
    const filterArg = args[1] && !args[1].startsWith('--') ? args[1] : ''
    const searchLc = filterArg.toLowerCase()

    const filteredLibs = (data.libraries || [])
      .filter((lib: any) => !libraryArg || lib.name === libraryArg)
      .map((lib: any) => {
        const filtered = (lib.components || []).filter((c: any) => {
          if (searchLc && !c.name.toLowerCase().includes(searchLc)) return false
          if (categoryArg && c.category !== categoryArg) return false
          return true
        })
        return { ...lib, _filtered: filtered, _total: filtered.length }
      })
      .filter((lib: any) => lib._filtered.length > 0)

    if (mcpFlag) {
      // Match annotask_get_components: compact summaries + pagination fields.
      const libraries = filteredLibs.map((lib: any) => ({
        name: lib.name,
        version: lib.version,
        total: lib._total,
        components: lib._filtered.slice(offsetArg, offsetArg + limitArg).map((c: any) => ({
          name: c.name,
          module: c.module,
          category: c.category ?? null,
          description: c.description ?? null,
          propCount: c.props?.length ?? 0,
          slotCount: c.slots?.length ?? 0,
          eventCount: c.events?.length ?? 0,
          deprecated: c.deprecated ? true : undefined,
        })),
      }))
      console.log(fmt({ libraries }))
      return
    }

    for (const lib of filteredLibs) {
      console.log(`\n${color('36', lib.name)} v${lib.version} (${lib._filtered.length} components)`)
      for (const comp of lib._filtered.slice(offsetArg, offsetArg + limitArg)) {
        const propCount = comp.props?.length || 0
        console.log(`  ${color('33', comp.name)}  ${comp.module}  (${propCount} props)`)
      }
    }
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch components: ${err.message}`)
    process.exit(1)
  }
}

// ── Component: show detailed info for one component ──

async function showComponent() {
  const name = args[1]
  if (!name) {
    console.error(`${color('31', '[Annotask]')} Usage: annotask component <ComponentName>`)
    process.exit(1)
  }

  const jsonFlag = args.includes('--json') || mcpFlag
  const libraryArg = args.find(a => a.startsWith('--library='))?.split('=')[1] || ''

  try {
    const res = await fetch(`${apiUrl}/components`)
    const data = await res.json()

    const matches: Array<{ library: string; version: string | undefined; component: any }> = []
    for (const lib of data.libraries || []) {
      if (libraryArg && lib.name !== libraryArg) continue
      for (const c of lib.components || []) {
        if (c.name.toLowerCase() === name.toLowerCase()) {
          matches.push({ library: lib.name, version: lib.version, component: c })
        }
      }
    }

    if (matches.length === 0) {
      if (mcpFlag) {
        console.error(fmt({ error: `Component not found: ${name}${libraryArg ? ` (library: ${libraryArg})` : ''}` }))
      } else {
        console.error(`${color('31', '[Annotask]')} Component "${name}" not found. Use ${color('33', 'annotask components')} to list available components.`)
      }
      process.exit(1)
    }

    if (matches.length > 1 && !libraryArg) {
      const ambiguous = {
        ambiguous: true,
        message: `Found ${matches.length} components named ${name}. Pass --library to disambiguate.`,
        candidates: matches.map(m => ({ library: m.library, module: m.component.module })),
      }
      if (mcpFlag) { console.log(fmt(ambiguous)); return }
      if (jsonFlag) { console.log(JSON.stringify(ambiguous, null, 2)); return }
      console.error(`${color('31', '[Annotask]')} ${ambiguous.message}`)
      for (const c of ambiguous.candidates) console.error(`  ${c.library}: ${c.module}`)
      process.exit(1)
    }

    const { library: libName, version, component: found } = matches[0]

    if (jsonFlag) {
      const payload = { library: libName, version, ...found }
      console.log(mcpFlag ? fmt(payload) : JSON.stringify(payload, null, 2))
      return
    }

    console.log(`\n${color('36', found.name)}`)
    console.log(`  Library: ${libName}`)
    console.log(`  Import:  ${found.module}`)

    if (found.props.length === 0) {
      console.log('  Props:   none')
    } else {
      console.log(`  Props:   ${found.props.length}\n`)
      for (const p of found.props) {
        const req = p.required ? ` ${color('33', '(required)')}` : ''
        const type = p.type ? color('90', p.type) : ''
        const def = p.default != null ? `  default: ${p.default}` : ''
        console.log(`  ${color('36', p.name)}  ${type}${req}${def}`)
        if (p.description) console.log(`    ${p.description}`)
      }
    }
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch component: ${err.message}`)
    process.exit(1)
  }
}

// ── Code context: resolve a task to grounded source context ─────

async function fetchCodeContext() {
  const taskId = args[1]
  if (!taskId) {
    console.error(`${color('31', '[Annotask]')} Usage: annotask code-context <task-id> [--context-lines=N]`)
    process.exit(1)
  }
  const ctxLinesArg = args.find(a => a.startsWith('--context-lines='))?.split('=')[1]
  const qs = ctxLinesArg ? `?context_lines=${encodeURIComponent(ctxLinesArg)}` : ''
  try {
    const res = await fetch(`${apiUrl}/code-context/${encodeURIComponent(taskId)}${qs}`)
    if (res.status === 404) {
      console.error(`${color('31', '[Annotask]')} Task not found: ${taskId}`)
      process.exit(1)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    console.log(fmt(data))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch code context: ${err.message}`)
    process.exit(1)
  }
}

// ── Component examples: in-repo usage sites for a component ─────

async function fetchComponentExamples() {
  const name = args[1]
  if (!name) {
    console.error(`${color('31', '[Annotask]')} Usage: annotask component-examples <ComponentName> [--limit=N] [--library=NAME]`)
    process.exit(1)
  }
  const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1]
  const libraryArg = args.find(a => a.startsWith('--library='))?.split('=')[1]
  const params = new URLSearchParams()
  if (limitArg) params.set('limit', limitArg)
  if (libraryArg) params.set('library', libraryArg)
  const qs = params.toString() ? `?${params.toString()}` : ''
  try {
    const res = await fetch(`${apiUrl}/component-examples/${encodeURIComponent(name)}${qs}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    console.log(fmt(data))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch component examples: ${err.message}`)
    process.exit(1)
  }
}

// ── Data context: resolve data sources for a task ──────

async function fetchDataContext() {
  const taskId = args[1]
  if (!taskId) {
    console.error(`${color('31', '[Annotask]')} Usage: annotask data-context <task-id> [--refresh]`)
    process.exit(1)
  }
  const refresh = args.includes('--refresh')
  try {
    // --refresh always forces a fresh resolve via the taskId endpoint, which
    // only returns stored data_context when absent — so to force-refresh we
    // call the resolve endpoint directly.
    let res: Response
    if (refresh) {
      const tasksRes = await fetch(`${apiUrl}/tasks/${encodeURIComponent(taskId)}`)
      if (tasksRes.status === 404) {
        console.error(`${color('31', '[Annotask]')} Task not found: ${taskId}`)
        process.exit(1)
      }
      const task = await tasksRes.json() as Record<string, unknown>
      const file = typeof task.file === 'string' ? task.file : ''
      const line = typeof task.line === 'number' ? task.line : 0
      if (!file) { console.error(`${color('31', '[Annotask]')} Task has no file reference`); process.exit(1) }
      res = await fetch(`${apiUrl}/data-context/resolve?file=${encodeURIComponent(file)}&line=${line}`)
    } else {
      res = await fetch(`${apiUrl}/data-context/${encodeURIComponent(taskId)}`)
      if (res.status === 404) {
        console.error(`${color('31', '[Annotask]')} Task not found: ${taskId}`)
        process.exit(1)
      }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    console.log(fmt(data))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch data context: ${err.message}`)
    process.exit(1)
  }
}

// ── Interaction history: pre-task user trace for a task ────

async function fetchInteractionHistory() {
  const taskId = args[1]
  if (!taskId) {
    console.error(`${color('31', '[Annotask]')} Usage: annotask interaction-history <task-id>`)
    process.exit(1)
  }
  try {
    const res = await fetch(`${apiUrl}/tasks/${encodeURIComponent(taskId)}/interaction-history`)
    if (res.status === 404) {
      console.error(`${color('31', '[Annotask]')} Task not found: ${taskId}`)
      process.exit(1)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    console.log(fmt(data))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch interaction history: ${err.message}`)
    process.exit(1)
  }
}

// ── Rendered HTML: outerHTML snapshot of the task's element ─

async function fetchRenderedHtml() {
  const taskId = args[1]
  if (!taskId) {
    console.error(`${color('31', '[Annotask]')} Usage: annotask rendered-html <task-id>`)
    process.exit(1)
  }
  try {
    const res = await fetch(`${apiUrl}/tasks/${encodeURIComponent(taskId)}/rendered-html`)
    if (res.status === 404) {
      console.error(`${color('31', '[Annotask]')} Task not found: ${taskId}`)
      process.exit(1)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    console.log(fmt(data))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch rendered HTML: ${err.message}`)
    process.exit(1)
  }
}

// ── Data sources: project-wide catalog ─────────────────

async function fetchDataSources() {
  const kind = args.find(a => a.startsWith('--kind='))?.split('=')[1]
  const library = args.find(a => a.startsWith('--library='))?.split('=')[1]
  const search = args.find(a => a.startsWith('--search='))?.split('=')[1]
  const usedOnly = args.includes('--used-only')
  const params = new URLSearchParams()
  if (kind) params.set('kind', kind)
  if (library) params.set('library', library)
  if (search) params.set('search', search)
  if (usedOnly) params.set('used_only', 'true')
  const qs = params.toString() ? `?${params.toString()}` : ''
  try {
    const res = await fetch(`${apiUrl}/data-sources${qs}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    console.log(fmt(data))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch data sources: ${err.message}`)
    process.exit(1)
  }
}

// ── Runtime endpoints: what the iframe has actually hit ─

async function fetchRuntimeEndpoints() {
  const route = args.find(a => a.startsWith('--route='))?.split('=')[1]
  const method = args.find(a => a.startsWith('--method='))?.split('=')[1]
  const search = args.find(a => a.startsWith('--search='))?.split('=')[1]
  const orphansOnly = args.includes('--orphans-only')
  const enrich = args.includes('--no-enrich') ? 'false' : 'true'
  const params = new URLSearchParams()
  params.set('merge_static', enrich)
  if (route) params.set('route', route)
  try {
    const res = await fetch(`${apiUrl}/runtime-endpoints?${params.toString()}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { endpoints?: Array<Record<string, unknown>> }
    let endpoints = data.endpoints ?? []
    if (method) {
      const m = method.toUpperCase()
      endpoints = endpoints.filter(ep => (ep.method as string) === m)
    }
    if (search) {
      const q = search.toLowerCase()
      endpoints = endpoints.filter(ep =>
        String(ep.path || '').toLowerCase().includes(q)
        || String(ep.pattern || '').toLowerCase().includes(q),
      )
    }
    if (orphansOnly) {
      endpoints = endpoints.filter(ep => {
        const matched = ep.matchedSources as string[] | undefined
        return !matched || matched.length === 0
      })
    }
    console.log(fmt({ ...data, endpoints }))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch runtime endpoints: ${err.message}`)
    process.exit(1)
  }
}

// ── Data source examples: in-repo usages of one name ───

async function fetchDataSourceExamples() {
  const name = args[1]
  if (!name) {
    console.error(`${color('31', '[Annotask]')} Usage: annotask data-source-examples <name> [--kind=composable|signal|store|fetch|graphql|loader|rpc] [--limit=N]`)
    process.exit(1)
  }
  const kind = args.find(a => a.startsWith('--kind='))?.split('=')[1]
  const limit = args.find(a => a.startsWith('--limit='))?.split('=')[1]
  const params = new URLSearchParams()
  if (kind) params.set('kind', kind)
  if (limit) params.set('limit', limit)
  const qs = params.toString() ? `?${params.toString()}` : ''
  try {
    const res = await fetch(`${apiUrl}/data-source-examples/${encodeURIComponent(name)}${qs}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    console.log(fmt(data))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch data source examples: ${err.message}`)
    process.exit(1)
  }
}

// ── Data source details: definition of one name ────────

async function fetchDataSourceDetails() {
  const name = args[1]
  if (!name) {
    console.error(`${color('31', '[Annotask]')} Usage: annotask data-source-details <name> [--kind=K] [--file=PATH] [--context-lines=N]`)
    process.exit(1)
  }
  const kind = args.find(a => a.startsWith('--kind='))?.split('=')[1]
  const file = args.find(a => a.startsWith('--file='))?.split('=')[1]
  const contextLines = args.find(a => a.startsWith('--context-lines='))?.split('=')[1]
  const params = new URLSearchParams()
  if (kind) params.set('kind', kind)
  if (file) params.set('file', file)
  if (contextLines) params.set('context_lines', contextLines)
  const qs = params.toString() ? `?${params.toString()}` : ''
  try {
    const res = await fetch(`${apiUrl}/data-source-details/${encodeURIComponent(name)}${qs}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    console.log(fmt(data))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch data source details: ${err.message}`)
    process.exit(1)
  }
}

// ── API schemas ────────────────────────────────────────

async function fetchApiSchemas() {
  const kind = args.find(a => a.startsWith('--kind='))?.split('=')[1]
  const detail = args.includes('--detail')
  const params = new URLSearchParams()
  if (kind) params.set('kind', kind)
  if (detail) params.set('detail', 'true')
  const qs = params.toString() ? `?${params.toString()}` : ''
  try {
    const res = await fetch(`${apiUrl}/api-schemas${qs}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    console.log(fmt(data))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch api schemas: ${err.message}`)
    process.exit(1)
  }
}

async function fetchApiOperation() {
  const opPath = args[1]
  if (!opPath) {
    console.error(`${color('31', '[Annotask]')} Usage: annotask api-operation <path> [--method=GET] [--schema-location=PATH]`)
    process.exit(1)
  }
  const method = args.find(a => a.startsWith('--method='))?.split('=')[1]
  const schemaLocation = args.find(a => a.startsWith('--schema-location='))?.split('=').slice(1).join('=')
  const params = new URLSearchParams()
  params.set('path', opPath)
  if (method) params.set('method', method)
  if (schemaLocation) params.set('schema_location', schemaLocation)
  try {
    const res = await fetch(`${apiUrl}/api-operation?${params.toString()}`)
    if (res.status === 404) {
      console.error(`${color('31', '[Annotask]')} Operation not found: ${opPath}`)
      process.exit(1)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    console.log(fmt(data))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to fetch api operation: ${err.message}`)
    process.exit(1)
  }
}

async function resolveEndpointCmd() {
  const url = args[1]
  if (!url) {
    console.error(`${color('31', '[Annotask]')} Usage: annotask resolve-endpoint <url> [--method=GET]`)
    process.exit(1)
  }
  const method = args.find(a => a.startsWith('--method='))?.split('=')[1]
  const params = new URLSearchParams()
  params.set('url', url)
  if (method) params.set('method', method)
  try {
    const res = await fetch(`${apiUrl}/resolve-endpoint?${params.toString()}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    console.log(fmt(data))
  } catch (err: any) {
    console.error(`${color('31', '[Annotask]')} Failed to resolve endpoint: ${err.message}`)
    process.exit(1)
  }
}

// ── MCP: stdio transport (proxies to HTTP MCP endpoint) ──

import { createInterface } from 'node:readline'
import { statSync } from 'node:fs'

/**
 * Resolve the MCP endpoint URL per request.
 *
 * Editors launch this proxy once per session, but the dev server's port can
 * change if the developer restarts it on a different port. We cache the parsed
 * server.json and only re-read when the file's mtime changes — keeps the hot
 * path a single `stat` call while still picking up port changes transparently.
 */
let cachedServerUrl: string | null = null
let cachedMtimeMs = 0

function resolveMcpUrl(): string | null {
  if (serverArg) return serverArg + '/__annotask/mcp'
  try {
    const st = statSync('.annotask/server.json')
    if (st.mtimeMs !== cachedMtimeMs || cachedServerUrl === null) {
      const raw = readFileSync('.annotask/server.json', 'utf-8')
      const parsed = JSON.parse(raw)
      cachedServerUrl = typeof parsed.url === 'string' ? parsed.url : null
      cachedMtimeMs = st.mtimeMs
    }
    return cachedServerUrl ? cachedServerUrl + '/__annotask/mcp' : null
  } catch {
    cachedServerUrl = null
    return null
  }
}

function runMcpStdio() {
  // Fail fast if we can't locate the dev server at launch — otherwise the
  // editor silently proxies every request to localhost:5173 and nothing works.
  const initialUrl = resolveMcpUrl()
  if (!initialUrl) {
    process.stderr.write(
      `[Annotask MCP] No .annotask/server.json found in ${process.cwd()}.\n` +
      `Start the Annotask dev server (e.g. 'pnpm dev') then restart your editor's MCP client.\n`,
    )
    // Keep running anyway — each request returns a JSON-RPC error so the editor
    // can retry once the server comes up without needing a hard restart.
  }

  const pending = new Set<Promise<void>>()
  let stdinClosed = false

  const rl = createInterface({ input: process.stdin, terminal: false })

  rl.on('line', (line) => {
    if (!line.trim()) return

    const p = (async () => {
      const mcpUrl = resolveMcpUrl()
      if (!mcpUrl) {
        let id: string | number | null = null
        try { id = JSON.parse(line).id ?? null } catch {}
        if (id !== null && id !== undefined) {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: `Annotask dev server not found — missing .annotask/server.json in ${process.cwd()}`,
            },
            id,
          }) + '\n')
        }
        return
      }
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
  task            Fetch a single task by id (trimmed agent_feedback)
  design-spec     Fetch design spec summary or a single --category
  report          Fetch the live change report (no tasks)
  status          Check if Annotask server is running
  components      List all available component library components
  component       Show detailed props for a specific component
  update-task     Update a task's status / resolution / feedback
  screenshot      Download a task's screenshot
  code-context    Resolve a task to grounded source context (excerpt, symbol, imports, hash)
  component-examples  Find in-repo usages of a component (snippet + import path)
  data-context    Resolve (or return stored) data_context for a task (hooks/stores/fetch refs)
  interaction-history  Fetch the user's pre-task navigation + action trace for a task
  rendered-html   Fetch the outerHTML snapshot captured for a task's selected element
  data-sources    List detected data libraries + project-specific hooks/stores/fetch wrappers
  data-source-examples  Find in-repo usages of a data source by name (symmetric with component-examples)
  data-source-details  Fetch the definition of a data source by name (signature, excerpt, siblings)
  api-schemas     List discovered OpenAPI / GraphQL / tRPC schemas (add --detail for full operations)
  api-operation   Fetch one operation by path (+ optional --method / --schema-location)
  resolve-endpoint  Match a concrete URL against discovered schemas; returns best-match operation
  runtime-endpoints List endpoints the iframe has actually hit at runtime (fetch/XHR/beacon).
                    Aggregated per (origin, method, path pattern). Supplements the regex
                    scanner by capturing dynamic endpoints the static pass misses.
  init-skills     Install AI agent skills to your project
  init-mcp        Write editor MCP config (Claude Code / Cursor / VS Code / Windsurf)
  mcp             Start MCP server (stdio transport, proxies to dev server)
  help            Show this help

\x1b[33mOptions:\x1b[0m
  --port=N          Dev server port — last-resort fallback. The CLI normally
                    auto-discovers the port from .annotask/server.json
                    (written by the dev server at startup). Only needed if
                    you're running annotask from outside the project root.
  --host=H          Dev server host (default: localhost). Same caveat as --port.
  --server=URL      Annotask server URL (overrides .annotask/server.json)
  --mfe=NAME        Filter tasks by MFE identity (overrides server.json mfe)
  --mcp             Emit MCP-parity output: compact JSON, no ANSI, matches the
                    annotask_* tool shapes. Use in agent skills so responses
                    are identical whether reached via MCP or the CLI.
  --pretty          Pretty-print JSON output (ignored under --mcp)
  --detail          tasks: return full task objects instead of summaries
  --status=STATUS   tasks: filter by status (pending, review, denied, ...)
  --category=NAME   design-spec: return a single token category
                    (colors, typography, spacing, borders, breakpoints,
                    icons, components, framework)
  --library=NAME    components / component: restrict to one library
  --limit=N         components / component-examples / data-source-examples: max results (default 50 / 3 / 3)
  --offset=N        components: skip the first N results (pagination)
  --context-lines=N code-context: lines of context around task.line (default 15, max 200)
                    data-source-details: lines around the definition (default 15, max 40)
  --file=PATH       data-source-details: disambiguate by file when multiple definitions share a name
  --refresh         data-context: force a fresh scan even if the task has stored data_context
  --used-only       data-sources: restrict project entries to used_count > 0
  --kind=K          data-sources / data-source-examples: filter by composable|signal|store|fetch|graphql|loader|rpc
                    api-schemas: filter by openapi|graphql|trpc|jsonschema
  --method=M        api-operation / resolve-endpoint: HTTP method (GET/POST/...) or GraphQL "query"/"mutation"
  --schema-location=L api-operation: disambiguate when multiple schemas contain the same path
  --search=Q        data-sources / runtime-endpoints: substring match on path/pattern
  --route=PATH      runtime-endpoints: only endpoints hit on this iframe route
  --orphans-only    runtime-endpoints: only endpoints with no matching static source
                    (gaps the regex scanner missed)
  --no-enrich       runtime-endpoints: skip static-source + OpenAPI cross-references
  --force           Overwrite existing skills / MCP entries (for init-skills, init-mcp)
  --target=NAME     Comma-separated targets (default: claude,agents)
                    Built-in: claude, agents, copilot
                    Custom: --target=.my-tool/skills
  --editor=NAME     Target editor for init-mcp (default: claude)
                    Valid: claude, cursor, vscode, windsurf, all
                    Multiple: --editor=claude,cursor
  --transport=T     init-mcp transport: stdio (default) or http. stdio uses
                    'npx annotask mcp' and auto-resolves the dev-server port
                    per request — survives port changes without editing
                    .mcp.json. http hardcodes the URL discovered at init time.

\x1b[33mExamples:\x1b[0m
  annotask tasks --mcp                    # Agent-parity compact summaries
  annotask tasks --mcp --detail           # Full task objects (visual stripped)
  annotask tasks --mcp --status=pending   # Filter by status
  annotask task TASK_ID --mcp             # Single task detail (MCP-parity)
  annotask design-spec --mcp              # Design spec summary
  annotask design-spec --mcp --category=colors   # Full colors payload
  annotask components --mcp Button        # Compact JSON, filtered by name
  annotask component Button --mcp         # Full component JSON
  annotask update-task TASK_ID --status=in_progress --mcp
  annotask status --mcp                   # Compact JSON status
  annotask watch                          # Watch live changes (human)
  annotask init-skills                    # Install AI agent skills
  annotask init-mcp                       # Write .mcp.json for Claude Code
  annotask init-mcp --editor=all          # Write MCP config for every supported editor
  annotask mcp                            # Start stdio MCP server
`)
}
