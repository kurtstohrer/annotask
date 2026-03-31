import { ref, computed } from 'vue'
import { on as wsOn } from '../services/wsClient'

export interface Task {
  id: string
  type: string
  description: string
  file: string
  line: number
  component?: string
  mfe?: string
  route?: string
  status: 'pending' | 'in_progress' | 'applied' | 'review' | 'accepted' | 'denied'
  intent?: string
  action?: string
  context?: Record<string, unknown>
  viewport?: { width: number | null; height: number | null }
  interaction_history?: { current_route: string; navigation_path: string[]; recent_actions: unknown[] }
  element_context?: { ancestors: unknown[]; subtree: unknown }
  screenshot?: string
  feedback?: string
  visual?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

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

  return {
    tasks, pendingTasks, reviewTasks, deniedTasks,
    isLoading,
    createTask, updateTask, deleteTask, updateTaskStatus,
    fetchTasks,
  }
}
