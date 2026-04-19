/**
 * Shell-side HTTP client for data-context endpoints. Mirrors how screenshot
 * upload bypasses the iframe bridge — the iframe can't read source; the
 * server can.
 */
import type { DataContext, DataSource } from '../../schema'

export interface DataContextProbeResult {
  hasData: boolean
  primaryKind?: DataSource['kind']
  primaryName?: string
}

async function request<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`/__annotask/api/${path}`)
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

/** Fast boolean + primary signal for selection-change UX. */
export function probeForSelection(file: string): Promise<DataContextProbeResult | null> {
  if (!file) return Promise.resolve({ hasData: false })
  return request<DataContextProbeResult>(`data-context/probe?file=${encodeURIComponent(file)}`)
}

/** Full resolve for attach-at-submit / always-capture-on-deny. */
export function resolveForSelection(file: string, line: number): Promise<DataContext | null> {
  if (!file) return Promise.resolve(null)
  return request<DataContext>(`data-context/resolve?file=${encodeURIComponent(file)}&line=${line}`)
}

/**
 * Narrow resolve: only returns sources whose binding graph includes a site at
 * (file, line). Empty `sources` means the selected element isn't actually
 * consuming any data source the analyzer can trace.
 */
export function resolveForElement(file: string, line: number): Promise<DataContext | null> {
  if (!file) return Promise.resolve(null)
  return request<DataContext>(`data-context/element?file=${encodeURIComponent(file)}&line=${line}`)
}
