<script lang="ts">
  import type { Country } from '../lib/api'
  import StatBar from './StatBar.svelte'

  interface Props {
    countries: Country[]
  }

  let { countries }: Props = $props()

  const maxPopulation = $derived(Math.max(...countries.map((c) => c.population), 0))
  const maxArea = $derived(Math.max(...countries.map((c) => c.area_km2), 0))
  const maxDensity = $derived(Math.max(...countries.map((c) => c.density ?? 0), 0))
</script>

<div class="compare">
  <header class="head">
    {#each countries as c}
      <div class="col">
        <span class="flag">{c.flag_emoji}</span>
        <h3>{c.name}</h3>
        <p>{c.capital}</p>
      </div>
    {/each}
  </header>

  <section class="metric">
    <h4>Population</h4>
    {#each countries as c}
      <StatBar value={c.population} max={maxPopulation} label={c.cca2} color="var(--accent)" />
    {/each}
  </section>

  <section class="metric">
    <h4>Area (km²)</h4>
    {#each countries as c}
      <StatBar value={c.area_km2} max={maxArea} label={c.cca2} color="var(--region-europe)" />
    {/each}
  </section>

  <section class="metric">
    <h4>Density (people / km²)</h4>
    {#each countries as c}
      <StatBar value={c.density ?? 0} max={maxDensity} label={c.cca2} color="var(--region-asia)" />
    {/each}
  </section>

  <section class="grid">
    <div class="cell-head">Region</div>
    {#each countries as c}<div class="cell">{c.region}</div>{/each}

    <div class="cell-head">Subregion</div>
    {#each countries as c}<div class="cell">{c.subregion}</div>{/each}

    <div class="cell-head">Languages</div>
    {#each countries as c}<div class="cell">{c.languages.join(', ')}</div>{/each}

    <div class="cell-head">Currencies</div>
    {#each countries as c}<div class="cell">{c.currencies.join(', ')}</div>{/each}
  </section>
</div>

<style>
  .compare {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .head {
    display: grid;
    grid-template-columns: repeat(var(--cols, auto-fit), minmax(180px, 1fr));
    gap: var(--space-4);
  }

  .col {
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    text-align: center;
  }

  .col .flag {
    font-size: 2.5rem;
    line-height: 1;
    display: block;
    margin-bottom: var(--space-3);
  }

  .col h3 {
    font-size: 1.05rem;
    margin: 0 0 var(--space-1) 0;
    color: var(--text);
  }

  .col p {
    font-size: 0.85rem;
    color: var(--text-subtle);
    margin: 0;
  }

  .metric {
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .metric h4 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
    font-weight: var(--weight-semibold);
    margin: 0 0 var(--space-2) 0;
  }

  .grid {
    display: grid;
    grid-template-columns: 140px repeat(auto-fit, minmax(140px, 1fr));
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .cell-head,
  .cell {
    padding: var(--space-3) var(--space-4);
    font-size: 0.9rem;
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
  }

  .cell-head {
    background: var(--surface-2);
    font-weight: var(--weight-semibold);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.75rem;
  }

  .cell {
    color: var(--text);
  }

  .grid > *:nth-last-child(-n + 5) {
    border-bottom: none;
  }
</style>
