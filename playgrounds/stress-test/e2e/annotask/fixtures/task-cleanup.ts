import type { APIRequestContext } from '@playwright/test'
import { apiUrl, type AppTarget } from './apps'

interface TaskRecord { id: string }
interface TaskList { tasks: TaskRecord[] }

export async function clearAllTasks(request: APIRequestContext, app: AppTarget): Promise<void> {
  const listRes = await request.get(apiUrl(app, '/tasks'))
  if (!listRes.ok()) return
  const body = (await listRes.json()) as TaskList
  if (!body.tasks || body.tasks.length === 0) return
  await Promise.all(body.tasks.map(t => request.delete(apiUrl(app, `/tasks/${t.id}`))))
}
