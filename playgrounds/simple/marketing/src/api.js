// Marketing API client — backed by the shared playground FastAPI service
// (playgrounds/simple/api, proxied via /api in vite.config.js).

/** Project stats: { installs, github_stars, contributors, frameworks_supported } */
export async function fetchStats() {
  const res = await fetch('/api/marketing/stats')
  if (!res.ok) throw new Error(`stats: ${res.status}`)
  return res.json()
}

/** Release feed: [{ version, date, headline, highlights }] — no UI consumes this yet. */
export async function fetchChangelog(limit = 5) {
  const res = await fetch(`/api/marketing/changelog?limit=${limit}`)
  if (!res.ok) throw new Error(`changelog: ${res.status}`)
  return res.json()
}
