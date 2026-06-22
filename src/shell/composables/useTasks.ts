import { ref, computed } from 'vue'
import { on as wsOn } from '../services/wsClient'
import type { AnnotaskTask, AgentFeedbackQuestion, AgentFeedbackEntry } from '../../schema'

export type Task = AnnotaskTask
export type { AgentFeedbackQuestion, AgentFeedbackEntry }

export interface TaskApiError {
  code: string
  message: string
}

const tasks = ref<Task[]>([])
const isLoading = ref(false)
/**
 * Last failed task mutation, or null after a success. The server rejects
 * bad payloads with a 400 (e.g. SafeSourceFile refusing a URL-shaped file
 * path) — before this ref existed those failures were silently swallowed
 * and the error body was returned as if it were the created task. UI
 * surfaces (pending task panel, App) read this to tell the user what
 * actually went wrong.
 */
const lastError = ref<TaskApiError | null>(null)

/** Parse the server's `{ error: { code, message } }` body (sendError in
 *  api.ts); fall back to the HTTP status for non-JSON bodies. */
async function readApiError(res: Response): Promise<TaskApiError> {
  try {
    const body = await res.json()
    if (body?.error?.code && body?.error?.message) {
      return { code: String(body.error.code), message: String(body.error.message) }
    }
  } catch { /* non-JSON body */ }
  return { code: 'http_error', message: `HTTP ${res.status}` }
}

async function fetchTasks() {
  try {
    isLoading.value = true
    const res = await fetch('/__annotask/api/tasks')
    const data = await res.json()
    tasks.value = data.tasks || []
  } catch { /* server not available */ }
  finally { isLoading.value = false }
}

async function createTask(task: Partial<Task>): Promise<Task | null> {
  try {
    const res = await fetch('/__annotask/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })
    if (!res.ok) {
      lastError.value = await readApiError(res)
      console.error(`[Annotask] createTask failed (${lastError.value.code}): ${lastError.value.message}`)
      return null
    }
    lastError.value = null
    const created = await res.json()
    await fetchTasks()
    return created
  } catch {
    lastError.value = { code: 'network_error', message: 'Could not reach the Annotask server' }
    console.error('[Annotask] createTask failed: server unreachable')
    return null
  }
}

async function updateTask(id: string, updates: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`/__annotask/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) {
      lastError.value = await readApiError(res)
      console.error(`[Annotask] updateTask failed (${lastError.value.code}): ${lastError.value.message}`)
      return false
    }
    lastError.value = null
    await fetchTasks()
    return true
  } catch {
    lastError.value = { code: 'network_error', message: 'Could not reach the Annotask server' }
    console.error('[Annotask] updateTask failed: server unreachable')
    return false
  }
}

async function deleteTask(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/__annotask/api/tasks/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      lastError.value = await readApiError(res)
      console.error(`[Annotask] deleteTask failed (${lastError.value.code}): ${lastError.value.message}`)
      return false
    }
    lastError.value = null
    await fetchTasks()
    return true
  } catch {
    lastError.value = { code: 'network_error', message: 'Could not reach the Annotask server' }
    console.error('[Annotask] deleteTask failed: server unreachable')
    return false
  }
}

async function updateTaskStatus(id: string, status: Task['status'], feedback?: string, extra?: Record<string, unknown>) {
  return updateTask(id, { status, ...(feedback ? { feedback } : {}), ...extra })
}

async function respondToAgent(id: string, answers: Array<{ id: string; value: string }>) {
  const task = tasks.value.find(t => t.id === id)
  if (!task?.agent_feedback?.length) return
  const thread = JSON.parse(JSON.stringify(task.agent_feedback)) as AgentFeedbackEntry[]
  const last = thread[thread.length - 1]
  if (last.answered_at) return // already answered
  last.answered_at = Date.now()
  last.answers = answers
  return updateTask(id, { status: 'in_progress', agent_feedback: thread, ...(task.mfe ? { mfe: task.mfe } : {}) })
}

let initialized = false

export function useTasks() {
  if (!initialized) {
    initialized = true
    fetchTasks()
    wsOn('tasks:updated', (data: unknown) => {
      const d = data as { tasks?: Task[] }
      tasks.value = d?.tasks || []
    })
    // While the socket is down we miss every tasks:updated broadcast (agents
    // keep mutating tasks via MCP/CLI regardless). Resync over HTTP as soon
    // as the connection comes back.
    wsOn('reconnected', () => { void fetchTasks() })
  }

  const pendingTasks = computed(() => tasks.value.filter(t => t.status === 'pending'))
  const reviewTasks = computed(() => tasks.value.filter(t => t.status === 'review'))
  const deniedTasks = computed(() => tasks.value.filter(t => t.status === 'denied'))
  const needsInfoTasks = computed(() => tasks.value.filter(t => t.status === 'needs_info'))
  const blockedTasks = computed(() => tasks.value.filter(t => t.status === 'blocked'))

  return {
    tasks, pendingTasks, reviewTasks, deniedTasks, needsInfoTasks, blockedTasks,
    isLoading, lastError,
    createTask, updateTask, deleteTask, updateTaskStatus, respondToAgent,
    fetchTasks,
  }
}
