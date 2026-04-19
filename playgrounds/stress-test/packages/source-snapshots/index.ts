// Pinned snapshots of external data sources. Used by upstream-adapters as
// the offline fallback so the stress lab is deterministic and demo-safe.

import githubTrending from './github-trending.json' with { type: 'json' }

export const snapshots = {
  githubTrending,
} as const

export type SnapshotKey = keyof typeof snapshots
