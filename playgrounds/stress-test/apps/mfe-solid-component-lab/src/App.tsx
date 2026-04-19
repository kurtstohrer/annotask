import { createResource, createSignal, For, Show } from 'solid-js'
import { Tabs } from '@kobalte/core/tabs'
import { Button } from '@kobalte/core/button'
import type { Health } from '@annotask/stress-contracts'
import { componentUsage, workflows } from '@annotask/stress-fixtures'

async function fetchHealth(): Promise<Health> {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function App() {
  const [reloadKey, setReloadKey] = createSignal(0)
  const [health] = createResource(reloadKey, fetchHealth)

  return (
    <main>
      <header>
        <h1>Solid Component Lab</h1>
        <p class="sub">
          MFE <code>solid-component-lab</code> · port 4240 · backed by Node on :4340 · Kobalte
        </p>
      </header>

      <section class="panel">
        <h2>What this stresses</h2>
        <ul>
          <li><code>createResource</code> + signals for nested reactive data</li>
          <li>Kobalte headless primitives (<code>Tabs</code>, <code>Button</code>) — component discovery</li>
          <li>Solid JSX template compilation with annotask data attributes</li>
        </ul>
      </section>

      <section class="panel">
        <div class="row">
          <h2 style={{ margin: 0 }}>Upstream health</h2>
          <Button class="btn" onClick={() => setReloadKey((k) => k + 1)}>Refresh</Button>
        </div>
        <Show when={health.loading}>
          <p>Loading /api/health…</p>
        </Show>
        <Show when={health.error}>
          <p class="err">
            Failed to reach Node service: <code>{String(health.error)}</code>. Start with <code>just node</code>.
          </p>
        </Show>
        <Show when={health() && !health.error}>
          <dl class="kv">
            <dt>status</dt><dd>{health()!.status}</dd>
            <dt>service</dt><dd>{health()!.service}</dd>
            <dt>port</dt><dd>{health()!.port}</dd>
            <dt>version</dt><dd>{health()!.version}</dd>
          </dl>
        </Show>
      </section>

      <section class="panel">
        <h2>Shared-data tabs</h2>
        <Tabs defaultValue="workflows">
          <Tabs.List class="tabs-list">
            <Tabs.Trigger value="workflows" class="tabs-trigger">Workflows</Tabs.Trigger>
            <Tabs.Trigger value="components" class="tabs-trigger">Component usage</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="workflows">
            <table>
              <thead>
                <tr><th>ID</th><th>Title</th><th>Owner</th><th>Status</th></tr>
              </thead>
              <tbody>
                <For each={workflows}>{(wf) => (
                  <tr>
                    <td><code>{wf.id}</code></td>
                    <td>{wf.title}</td>
                    <td>{wf.owner}</td>
                    <td>{wf.status}</td>
                  </tr>
                )}</For>
              </tbody>
            </table>
          </Tabs.Content>

          <Tabs.Content value="components">
            <table>
              <thead>
                <tr><th>Name</th><th>Framework</th><th>Library</th><th>Uses</th></tr>
              </thead>
              <tbody>
                <For each={componentUsage}>{(c) => (
                  <tr>
                    <td><code>{c.name}</code></td>
                    <td>{c.framework}</td>
                    <td>{c.library}</td>
                    <td>{c.uses}</td>
                  </tr>
                )}</For>
              </tbody>
            </table>
          </Tabs.Content>
        </Tabs>
      </section>
    </main>
  )
}
