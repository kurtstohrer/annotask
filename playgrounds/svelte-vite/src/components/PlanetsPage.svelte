<script lang="ts">
  let planets = $state<any[]>([])
  let loading = $state(true)
  let error = $state('')

  $effect(() => {
    fetch('/api/planets')
      .then(r => r.json())
      .then(data => { planets = data.planets; loading = false })
      .catch(e => { error = e.message; loading = false })
  })
</script>

<section class="planets-page">
  <h2 class="page-title">Planets</h2>
  <p class="page-desc">Explore the planets of our solar system and beyond.</p>

  {#if loading}
    <p class="status-msg">Loading...</p>
  {:else if error}
    <p class="status-msg error">Error: {error}</p>
  {:else}
    <div class="table-wrapper">
      <table class="planet-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Distance (M km)</th>
            <th>Radius (km)</th>
            <th>Moons</th>
            <th>Temp (&deg;C)</th>
          </tr>
        </thead>
        <tbody>
          {#each planets as planet}
            <tr>
              <td class="planet-name">
                <span class="color-dot" style="background-color: {planet.color}"></span>
                {planet.name}
              </td>
              <td>{planet.type}</td>
              <td>{planet.distance_from_sun_mkm}</td>
              <td>{planet.radius_km.toLocaleString()}</td>
              <td>{planet.moons}</td>
              <td>{planet.avg_temp_c}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .planets-page {
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

  .planet-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 700px;
  }

  .planet-table thead {
    background-color: #271d2f;
  }

  .planet-table th {
    padding: 0.875rem 1.25rem;
    text-align: left;
    font-weight: 600;
    color: #7020b1;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 2px solid #2e1c4f;
  }

  .planet-table td {
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid #322447;
    color: #a0b3c6;
    font-size: 0.95rem;
  }

  .planet-table tbody tr:hover {
    background-color: #322541;
  }

  .planet-table tbody tr:last-child td {
    border-bottom: none;
  }

  .planet-name {
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
</style>
