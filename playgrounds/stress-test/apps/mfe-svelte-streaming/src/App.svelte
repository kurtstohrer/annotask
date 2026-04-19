<script>
  let health = $state(null)
  let error = $state(null)
  let loading = $state(true)

  async function load() {
    loading = true
    error = null
    try {
      const res = await fetch('/api/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      health = await res.json()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  load()
</script>

<main>
  <header>
    <h1>Svelte Streaming</h1>
    <p class="sub">
      MFE id <code>svelte-streaming</code> · port 4230 · backed by Go on :4330
    </p>
  </header>

  <section class="panel">
    <h2>What this stresses</h2>
    <ul>
      <li>Svelte stores + async modules for streaming/compare flows</li>
      <li>Go-backed SSE/telemetry feeds, live perf updates</li>
      <li>Route-persistence + localStorage under fast-changing data</li>
    </ul>
  </section>

  <section class="panel">
    <h2>Upstream health</h2>
    {#if loading}
      <p>Loading <code>/api/health</code>…</p>
    {:else if error}
      <p class="err">
        Failed to reach Go service: <code>{error}</code>. Start it with
        <code>pnpm dev:stress-go-api</code>.
      </p>
    {:else if health}
      <dl class="kv">
        <dt>status</dt><dd>{health.status}</dd>
        <dt>service</dt><dd>{health.service}</dd>
        <dt>port</dt><dd>{health.port}</dd>
        <dt>version</dt><dd>{health.version}</dd>
      </dl>
    {/if}
    <button type="button" class="btn" onclick={load}>Refresh</button>
  </section>
</main>

<style>
  main { font-family: system-ui, sans-serif; color: #1a202c; padding: 28px 32px; max-width: 780px; line-height: 1.55; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .sub { color: #64748b; margin: 0 0 24px; font-size: 13px; }
  .panel { border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; background: #fff; }
  .panel h2 { margin: 0 0 10px; font-size: 15px; color: #334155; }
  .kv { display: grid; grid-template-columns: 100px 1fr; gap: 6px 16px; margin: 8px 0 12px; font-size: 13px; }
  .kv dt { color: #64748b; }
  .kv dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  .err { color: #b91c1c; }
  .btn { padding: 6px 14px; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; cursor: pointer; font-size: 13px; }
  code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; background: #f1f5f9; padding: 1px 5px; border-radius: 4px; }
</style>
