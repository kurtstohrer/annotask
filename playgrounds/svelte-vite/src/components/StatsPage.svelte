<script lang="ts">
  let stats = $state<any>(null)
  let loading = $state(true)
  let error = $state('')

  $effect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(data => { stats = data; loading = false })
      .catch(e => { error = e.message; loading = false })
  })
</script>

<section class="stats-page">
  <h2 class="page-title">Solar System Stats</h2>
  <p class="page-desc">Key statistics about our solar system at a glance.</p>

  {#if loading}
    <p class="status-msg">Loading...</p>
  {:else if error}
    <p class="status-msg error">Error: {error}</p>
  {:else if stats}
    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-value">{stats.total_planets}</span>
        <span class="stat-label">Total Planets</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{stats.total_moons}</span>
        <span class="stat-label">Total Moons</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{stats.largest_planet}</span>
        <span class="stat-label">Largest Planet</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{stats.smallest_planet}</span>
        <span class="stat-label">Smallest Planet</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{stats.hottest_planet}</span>
        <span class="stat-label">Hottest Planet</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">{stats.coldest_planet}</span>
        <span class="stat-label">Coldest Planet</span>
      </div>
    </div>
  {/if}
</section>

<style>
  .stats-page {
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .page-title {
    font-size: 1.75rem;
    color: #e2e8f0;
    margin: 0 0 0.5rem 0;
  }

  .page-desc {
    color: #7a8fa3;
    margin: 0 0 2rem 0;
    font-size: 1rem;
  }

  .status-msg {
    color: #c8d6e5;
    font-size: 1rem;
    padding: 2rem;
    text-align: center;
  }

  .status-msg.error {
    color: #f87171;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1.25rem;
  }

  .stat-card {
    background-color: #424952;
    border: 1px solid #2e1c4f;
    border-radius: 8px;
    padding: 1.5rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    transition: border-color 0.2s ease, transform 0.2s ease;
  }

  .stat-card:hover {
    border-color: #201d49;
    transform: translateY(-2px);
  }

  .stat-value {
    font-size: 1.75rem;
    font-weight: 700;
    color: #7020b1;
    word-break: break-word;
  }

  .stat-label {
    font-size: 0.8rem;
    color: #5a7a96;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
