import { createResource, createSignal, For, Show } from 'solid-js'
import { Tabs } from '@kobalte/core/tabs'
import { Button } from '@kobalte/core/button'
import type { Health, Product } from '@annotask/stress-contracts'
import { componentUsage, products as seedProducts, workflows } from '@annotask/stress-fixtures'

// Absolute URL — works both solo (:4240 → :4340) and single-spa (:4200 → :4340).
const API_BASE = 'http://localhost:4340'

async function fetchHealth(): Promise<Health> {
  const res = await fetch(`${API_BASE}/api/health`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

type ProductCategory = 'all' | 'hardware' | 'software' | 'service'
const CATEGORIES: ProductCategory[] = ['all', 'hardware', 'software', 'service']

async function fetchProducts(category: ProductCategory): Promise<Product[]> {
  const url = new URL(`${API_BASE}/api/products`)
  if (category !== 'all') url.searchParams.set('category', category)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function App() {
  const [reloadKey, setReloadKey] = createSignal(0)
  const [health] = createResource(reloadKey, fetchHealth)
  const [category, setCategory] = createSignal<ProductCategory>('all')
  const [products] = createResource(category, fetchProducts)

  return (
    <main class="solid-mfe">
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
          <li>Node <code>/api/products?category=</code> filter exercised via Products tab</li>
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
        <Tabs defaultValue="products">
          <Tabs.List class="tabs-list">
            <Tabs.Trigger value="products" class="tabs-trigger">Products (Node API)</Tabs.Trigger>
            <Tabs.Trigger value="workflows" class="tabs-trigger">Workflows</Tabs.Trigger>
            <Tabs.Trigger value="components" class="tabs-trigger">Component usage</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="products">
            <div class="row" style={{ 'margin-bottom': '8px' }}>
              <div class="pill-group">
                <For each={CATEGORIES}>{(c) => (
                  <Button
                    class={category() === c ? 'btn active' : 'btn'}
                    onClick={() => setCategory(c)}
                  >{c}</Button>
                )}</For>
              </div>
              <small style={{ color: 'var(--stress-text-muted)' }}>
                GET {API_BASE}/api/products{category() === 'all' ? '' : `?category=${category()}`}
              </small>
            </div>
            <Show when={products.loading}>
              <p>Loading /api/products…</p>
            </Show>
            <Show when={products.error}>
              <p class="err">
                Node /api/products unreachable — showing fixture fallback.
              </p>
              <table>
                <thead>
                  <tr><th>ID</th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th></tr>
                </thead>
                <tbody>
                  <For each={seedProducts}>{(p) => (
                    <tr>
                      <td><code>{p.id}</code></td>
                      <td>{p.name}</td>
                      <td>{p.category}</td>
                      <td>${(p.price_cents / 100).toFixed(2)}</td>
                      <td>{p.in_stock ? 'yes' : 'no'}</td>
                    </tr>
                  )}</For>
                </tbody>
              </table>
            </Show>
            <Show when={products() && !products.error}>
              <table>
                <thead>
                  <tr><th>ID</th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th></tr>
                </thead>
                <tbody>
                  <For each={products()!}>{(p) => (
                    <tr>
                      <td><code>{p.id}</code></td>
                      <td>{p.name}</td>
                      <td>{p.category}</td>
                      <td>${(p.price_cents / 100).toFixed(2)}</td>
                      <td>{p.in_stock ? 'yes' : 'no'}</td>
                    </tr>
                  )}</For>
                </tbody>
              </table>
            </Show>
          </Tabs.Content>

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
