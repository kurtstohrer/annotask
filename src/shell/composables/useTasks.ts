import { ref, computed } from 'vue'
import { on as wsOn } from '../services/wsClient'
import type { AnnotaskTask, AgentFeedbackQuestion, AgentFeedbackEntry } from '../../schema'

export type Task = AnnotaskTask
export type { AgentFeedbackQuestion, AgentFeedbackEntry }

const tasks = ref<Task[]>([])
const isLoading = ref(false)

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
    const created = await res.json()
    await fetchTasks()
    return created
  } catch { return null }
}

async function updateTask(id: string, updates: Record<string, unknown>) {
  try {
    await fetch(`/__annotask/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    await fetchTasks()
  } catch {}
}

async function deleteTask(id: string) {
  try {
    await fetch(`/__annotask/api/tasks/${id}`, { method: 'DELETE' })
    await fetchTasks()
  } catch {}
}

async function updateTaskStatus(id: string, status: Task['status'], feedback?: string, extra?: Record<string, unknown>) {
  return updateTask(id, { status, ...(feedback ? { feedback } : {}), ...extra })
}

async function respondToAgent(id: string, answers: Array<{ id: string; value: string }>) {
  const task = tasks.value.find(t => t.id === id)
  if (!task?.agent_feedback?.length) return
  const thread = structuredClone(task.agent_feedback)
  const last = thread[thread.length - 1]
  if (last.answered_at) return // already answered
  last.answered_at = Date.now()
  last.answers = answers
  return updateTask(id, { status: 'in_progress', agent_feedback: thread })
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
  }

  const pendingTasks = computed(() => tasks.value.filter(t => t.status === 'pending'))
  const reviewTasks = computed(() => tasks.value.filter(t => t.status === 'review'))
  const deniedTasks = computed(() => tasks.value.filter(t => t.status === 'denied'))
  const needsInfoTasks = computed(() => tasks.value.filter(t => t.status === 'needs_info'))
  const blockedTasks = computed(() => tasks.value.filter(t => t.status === 'blocked'))

  return {
    tasks, pendingTasks, reviewTasks, deniedTasks, needsInfoTasks, blockedTasks,
    isLoading,
    createTask, updateTask, deleteTask, updateTaskStatus, respondToAgent,
    fetchTasks,
  }
}
