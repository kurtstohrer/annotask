import { useCallback, useEffect, useState } from 'react'

interface Health {
  status: string
  service: string
  port: number
  version: string
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setHealth((await res.json()) as Health)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <main style={styles.page}>
      <header>
        <h1 style={styles.h1}>React Workflows</h1>
        <p style={styles.sub}>
          MFE id <code>react-workflows</code> · port 4210 · backed by Java on :4310
        </p>
      </header>

      <section style={styles.panel}>
        <h2 style={styles.h2}>What this stresses</h2>
        <ul>
          <li>React hooks + query/mutation pattern for dense CRUD</li>
          <li>Workflow-heavy state transitions and review queues</li>
          <li>Cross-MFE task routing — tasks land under <code>mfe: react-workflows</code></li>
        </ul>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.h2}>Upstream health</h2>
        {loading && <p>Loading <code>/api/health</code>…</p>}
        {error && (
          <p style={styles.err}>
            Failed to reach Java service: <code>{error}</code>. Start it with{' '}
            <code>pnpm dev:stress-java-api</code> (Docker, see README).
          </p>
        )}
        {health && (
          <dl style={styles.kv}>
            <dt>status</dt><dd>{health.status}</dd>
            <dt>service</dt><dd>{health.service}</dd>
            <dt>port</dt><dd>{health.port}</dd>
            <dt>version</dt><dd>{health.version}</dd>
          </dl>
        )}
        <button type="button" onClick={load} style={styles.btn}>Refresh</button>
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { fontFamily: 'system-ui, sans-serif', color: '#1a202c', padding: '28px 32px', maxWidth: 780, lineHeight: 1.55 },
  h1: { margin: '0 0 4px', fontSize: 22 },
  sub: { color: '#64748b', margin: '0 0 24px', fontSize: 13 },
  panel: { border: '1px solid #e2e8f0', borderRadius: 10, padding: '18px 20px', marginBottom: 16, background: '#fff' },
  h2: { margin: '0 0 10px', fontSize: 15, color: '#334155' },
  kv: { display: 'grid', gridTemplateColumns: '100px 1fr', gap: '6px 16px', margin: '8px 0 12px', fontSize: 13 },
  err: { color: '#b91c1c' },
  btn: { padding: '6px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontSize: 13 },
}
