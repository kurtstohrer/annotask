<script lang="ts">
  let moons = $state<any[]>([])
  let loading = $state(true)
  let error = $state('')

  $effect(() => {
    fetch('/api/moons')
      .then(r => r.json())
      .then(data => { moons = data.moons; loading = false })
      .catch(e => { error = e.message; loading = false })
  })
</script>

<section class="moons-page">
  <h2 class="page-title">Moons</h2>
  <p class="page-desc">Discover the natural satellites orbiting the planets of our solar system.</p>

  {#if loading}
    <p class="status-msg">Loading...</p>
  {:else if error}
    <p class="status-msg error">Error: {error}</p>
  {:else}
    <div class="table-wrapper">
      <table class="moon-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Planet</th>
            <th>Radius (km)</th>
            <th>Orbital Period (days)</th>
            <th>Discovered By</th>
            <th>Year</th>
          </tr>
        </thead>
        <tbody>
          {#each moons as moon}
            <tr>
              <td class="moon-name">
                <span class="color-dot" style="background-color: {moon.color}"></span>
                {moon.name}
              </td>
              <td><span class="moon-planet">{moon.planet}</span></td>
              <td>{moon.radius_km.toLocaleString()}</td>
              <td>{moon.orbital_period_days}</td>
              <td>{moon.discovered_by}</td>
              <td>{moon.year_discovered}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .moons-page {
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

  .table-wrapper {
    overflow-x: auto;
    border-radius: 8px;
    border: 1px solid #2e1c4f;
  }

  .moon-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 700px;
  }

  .moon-table thead {
    background-color: #271d2f;
  }

  .moon-table th {
    padding: 0.875rem 1.25rem;
    text-align: left;
    font-weight: 600;
    color: #7020b1;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 2px solid #2e1c4f;
  }

  .moon-table td {
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid #322447;
    color: #a0b3c6;
    font-size: 0.95rem;
  }

  .moon-table tbody tr:hover {
    background-color: #322541;
  }

  .moon-table tbody tr:last-child td {
    border-bottom: none;
  }

  .moon-name {
    color: #e2e8f0;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .color-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  .moon-planet {
    font-size: 0.75rem;
    color: #7020b1;
    background-color: #6a6b43;
    padding: 0.2rem 0.6rem;
    border-radius: 12px;
    border: 1px solid #1e1330;
    white-space: nowrap;
  }
</style>
