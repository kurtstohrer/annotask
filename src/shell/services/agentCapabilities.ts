/**
 * Local-CLI capability snapshot for the embedded runner.
 *
 * Thin browser-side cache over `GET /__annotask/api/agent/detect` — the
 * server-side probe that inspects installed CLIs (found/version/loggedIn and,
 * since session-resume support landed, a `resume` flag greped from each CLI's
 * help text). The runner asks ONE question before each turn: "may I pass
 * `resumeSessionId` for this provider?" — so that's the only accessor
 * exported beyond the raw fetch.
 *
 * Failure posture: every failure path answers `false`. Resume is a token
 * optimization; the full-history replay path is the always-correct fallback,
 * so an unreachable dev server or a mid-probe error must never block a run.
 *
 * The snapshot is cached for the module lifetime (a page session). The
 * server's own probe re-runs every 30s, but resume support only changes when
 * the user upgrades a CLI binary — a reload-to-refresh surface is fine.
 */

export interface CliCapabilityFlags {
  resume?: boolean
  appendSystemPrompt?: boolean
  stdinPrompt?: boolean
}

interface DetectCliStatus extends CliCapabilityFlags {
  found?: boolean
}

type DetectSnapshot = Partial<Record<string, DetectCliStatus>>

let snapshotPromise: Promise<DetectSnapshot | null> | null = null

async function fetchSnapshot(): Promise<DetectSnapshot | null> {
  try {
    const res = await fetch('/__annotask/api/agent/detect')
    if (!res.ok) return null
    return await res.json() as DetectSnapshot
  } catch {
    return null
  }
}

/**
 * The probed capability flags for a provider's CLI. Empty object on any
 * failure — every consumer treats a missing flag as "unsupported".
 */
export async function cliCapabilities(providerId: string): Promise<CliCapabilityFlags> {
  if (!snapshotPromise) snapshotPromise = fetchSnapshot()
  const snapshot = await snapshotPromise
  if (!snapshot) {
    // Don't cache a dead-server answer forever — the next turn re-asks.
    snapshotPromise = null
    return {}
  }
  const s = snapshot[providerId]
  if (!s) return {}
  return { resume: s.resume, appendSystemPrompt: s.appendSystemPrompt, stdinPrompt: s.stdinPrompt }
}

/**
 * True iff the detect probe positively confirmed the provider's CLI supports
 * session resume. `undefined`/missing/unreachable all answer `false`.
 */
export async function resumeSupported(providerId: string): Promise<boolean> {
  return (await cliCapabilities(providerId)).resume === true
}

/** Test seam — drop the cached snapshot. */
export function resetAgentCapabilitiesForTests(): void {
  snapshotPromise = null
}
