import { ref } from 'vue'

export type InteractionEventType = 'route_change' | 'action'

export interface InteractionEntry {
  event: InteractionEventType
  route: string
  data: Record<string, unknown>
}

export interface InteractionSnapshot {
  current_route: string
  navigation_path: string[]
  recent_actions: InteractionEntry[]
}

const MAX_ENTRIES = 100
const SNAPSHOT_SIZE = 20

const history = ref<InteractionEntry[]>([])
const sessionStart = Date.now()

export function useInteractionHistory() {
  function push(event: InteractionEventType, route: string, data: Record<string, unknown>) {
    // Strip empty string values to keep payloads lean
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      if (v !== '') clean[k] = v
    }
    history.value.push({ event, route, data: clean })
    if (history.value.length > MAX_ENTRIES) {
      history.value.splice(0, history.value.length - MAX_ENTRIES)
    }
  }

  function getNavigationPath(): string[] {
    const path: string[] = []
    for (const entry of history.value) {
      if (entry.event === 'route_change') {
        const route = (entry.data.path as string) || entry.route
        if (path[path.length - 1] !== route) path.push(route)
      } else if (path.length === 0 && entry.route) {
        path.push(entry.route)
      }
    }
    return path
  }

  function snapshotForChange(currentRoute: string): InteractionSnapshot {
    // Deduplicate route from entries when it matches current_route
    const recent = history.value.slice(-SNAPSHOT_SIZE).map(e => {
      if (e.route === currentRoute) {
        const { route, ...rest } = e
        return rest as InteractionEntry
      }
      return e
    })
    return {
      current_route: currentRoute,
      navigation_path: getNavigationPath(),
      recent_actions: recent,
    }
  }

  function clear() {
    history.value = []
  }

  return { push, snapshotForChange, clear, history }
}
