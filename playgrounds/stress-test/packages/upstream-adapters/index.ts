// Adapters that sit between a live external source and the service layer.
// Every adapter attempts the live fetch first; on any failure (network,
// HTTP error, shape mismatch) it falls back to the pinned in-repo
// snapshot so the stress lab stays deterministic offline.
//
// Annotask's data-source discovery pattern should recognise the live URL
// as well as the local JSON fallback as two related sources.

import { snapshots } from '@annotask/stress-snapshots'

export interface AdapterResult<T> {
  source: 'live' | 'snapshot'
  fetched_at: string
  data: T
}

async function withSnapshotFallback<T>(
  live: () => Promise<T>,
  snapshot: T,
  timeoutMs = 2000,
): Promise<AdapterResult<T>> {
  const timer = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('upstream_timeout')), timeoutMs),
  )
  try {
    const data = await Promise.race([live(), timer])
    return { source: 'live', fetched_at: new Date().toISOString(), data }
  } catch {
    return { source: 'snapshot', fetched_at: new Date().toISOString(), data: snapshot }
  }
}

export async function githubTrending(): Promise<AdapterResult<typeof snapshots.githubTrending>> {
  return withSnapshotFallback(
    async () => {
      // Placeholder — real implementation would hit a GitHub trending proxy.
      // We throw here to exercise the fallback path deterministically.
      throw new Error('not_implemented_in_skeleton')
    },
    snapshots.githubTrending,
  )
}
