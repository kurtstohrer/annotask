import { createResource, createSignal, Show } from 'solid-js'

interface Health {
  status: string
  service: string
  port: number
  version: string
}

async function fetchHealth(): Promise<Health> {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function App() {
  const [reloadKey, setReloadKey] = createSignal(0)
  const [health] = createResource(reloadKey, fetchHealth)

  return (
    <main style={styles.page}>
      <header>
        <h1 style={styles.h1}>Solid Component Lab</h1>
        <p style={styles.sub}>
          MFE id <code>solid-component-lab</code> · port 4240 · backed by Node on :4340
        </p>
      </header>

      <section style={styles.panel}>
        <h2 style={styles.h2}>What this stresses</h2>
        <ul>
          <li><code>createResource</code> + signals for nested reactive data</li>
          <li>Solid's JSX template compilation — annotask data attributes inside <code>_$template()</code></li>
          <li>Component registry / dynamic imports driven by Node service</li>
        </ul>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.h2}>Upstream health</h2>
        <Show when={health.loading}>
          <p>Loading <code>/api/health</code>…</p>
        </Show>
        <Show when={health.error}>
          <p style={styles.err}>
            Failed to reach Node service: <code>{String(health.error)}</code>. Start it with{' '}
            <code>pnpm dev:stress-node-api</code>.
          </p>
        </Show>
        <Show when={health() && !health.error}>
          <dl style={styles.kv}>
            <dt>status</dt><dd>{health()!.status}</dd>
            <dt>service</dt><dd>{health()!.service}</dd>
            <dt>port</dt><dd>{health()!.port}</dd>
            <dt>version</dt><dd>{health()!.version}</dd>
          </dl>
        </Show>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} style={styles.btn}>
          Refresh
        </button>
      </section>
    </main>
  )
}

const styles = {
  page: { 'font-family': 'system-ui, sans-serif', color: '#1a202c', padding: '28px 32px', 'max-width': '780px', 'line-height': '1.55' },
  h1: { margin: '0 0 4px', 'font-size': '22px' },
  sub: { color: '#64748b', margin: '0 0 24px', 'font-size': '13px' },
  panel: { border: '1px solid #e2e8f0', 'border-radius': '10px', padding: '18px 20px', 'margin-bottom': '16px', background: '#fff' },
  h2: { margin: '0 0 10px', 'font-size': '15px', color: '#334155' },
  kv: { display: 'grid', 'grid-template-columns': '100px 1fr', gap: '6px 16px', margin: '8px 0 12px', 'font-size': '13px' },
  err: { color: '#b91c1c' },
  btn: { padding: '6px 14px', 'border-radius': '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', 'font-size': '13px' },
} as const
