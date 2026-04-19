<script>
  import { Dialog } from 'bits-ui'
  import { workflows, metrics } from '@annotask/stress-fixtures'

  let health = $state(null)
  let error = $state(null)
  let loading = $state(true)
  let detailOpen = $state(false)
  let detailWorkflow = $state(null)

  // Absolute URL — works solo (:4230) and under single-spa (:4200).
  const API_BASE = 'http://localhost:4330'

  async function load() {
    loading = true
    error = null
    try {
      const res = await fetch(`${API_BASE}/api/health`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      health = await res.json()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function pillClass(status) {
    if (status === 'accepted') return 'pill ok'
    if (status === 'denied') return 'pill err'
    if (status === 'pending') return 'pill warn'
    return 'pill'
  }

  function openDetail(wf) {
    detailWorkflow = wf
    detailOpen = true
  }

  // Curried so the template can reference `inspectFor(wf)` without an
  // inline arrow. The annotask Svelte transform's findTagEnd scanner
  // mis-parses the `>` inside `{() => ...}` as a tag close, so we avoid
  // arrows in template attribute values until that's fixed upstream.
  function inspectFor(wf) {
    return function () {
      openDetail(wf)
    }
  }

  load()
</script>

<main>
  <header>
    <h1>Svelte Streaming</h1>
    <p class="sub">
      MFE <code>svelte-streaming</code> · port 4230 · backed by Go on :4330 · bits-ui
    </p>
  </header>

  <section class="panel">
    <h2>What this stresses</h2>
    <ul>
      <li>Svelte 5 runes + <code>bits-ui</code> Dialog component discovery</li>
      <li>Go-backed telemetry series + live updates</li>
      <li>Route-persistence + localStorage under fast-changing data</li>
    </ul>
  </section>

  <section class="panel">
    <div class="row">
      <h2 style="margin:0">Upstream health</h2>
      <button class="btn" type="button" onclick={load}>Refresh</button>
    </div>
    {#if loading}
      <p>Loading /api/health…</p>
    {:else if error}
      <p class="err">Failed to reach Go service: <code>{error}</code>. Start it with <code>just go</code>.</p>
    {:else if health}
      <dl class="kv">
        <dt>status</dt><dd>{health.status}</dd>
        <dt>service</dt><dd>{health.service}</dd>
        <dt>port</dt><dd>{health.port}</dd>
        <dt>version</dt><dd>{health.version}</dd>
      </dl>
    {/if}
  </section>

  <section class="panel">
    <h2>Workflows</h2>
    <table>
      <thead>
        <tr><th>ID</th><th>Title</th><th>Owner</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>
        {#each workflows as wf}
          <tr>
            <td><code>{wf.id}</code></td>
            <td>{wf.title}</td>
            <td>{wf.owner}</td>
            <td><span class={pillClass(wf.status)}>{wf.status}</span></td>
            <td><button class="btn" type="button" onclick={inspectFor(wf)}>Inspect</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="panel">
    <h2>Metric series (from shared-fixtures)</h2>
    {#each metrics as series}
      <h3 style="font-size: 13px; color: var(--stress-text-muted); margin: 12px 0 4px">
        {series.name} <span class="pill">{series.unit}</span>
      </h3>
      <div style="display: flex; gap: 4px; align-items: flex-end; height: 48px;">
        {#each series.points as p}
          <div style="flex:1; background: var(--stress-accent); opacity: 0.8; height: {p.value / 7}%; min-height: 4px;" title="{p.t}: {p.value}"></div>
        {/each}
      </div>
    {/each}
  </section>
</main>

<Dialog.Root bind:open={detailOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay" />
    <Dialog.Content class="dialog-content">
      <Dialog.Title>
        <h3>{detailWorkflow?.title ?? 'Workflow'}</h3>
      </Dialog.Title>
      {#if detailWorkflow}
        <dl class="kv">
          <dt>id</dt><dd><code>{detailWorkflow.id}</code></dd>
          <dt>status</dt><dd>{detailWorkflow.status}</dd>
          <dt>owner</dt><dd>{detailWorkflow.owner}</dd>
          <dt>created</dt><dd><code>{detailWorkflow.created_at}</code></dd>
        </dl>
      {/if}
      <div style="margin-top: 16px; display: flex; justify-content: flex-end">
        <Dialog.Close class="btn">Close</Dialog.Close>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
