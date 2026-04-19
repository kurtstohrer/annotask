<script lang="ts">
  import { getCountry, type Country } from '../lib/api'
  import { navigate } from '../lib/router.svelte'

  interface Props {
    cca2: string
    inCompare: boolean
    onToggleCompare: (cca2: string) => void
  }

  let { cca2, inCompare, onToggleCompare }: Props = $props()

  let country = $state<Country | null>(null)
  let loading = $state(true)
  let error = $state('')

  $effect(() => {
    loading = true
    error = ''
    country = null
    getCountry(cca2)
      .then((c) => {
        country = c
      })
      .catch((e) => {
        error = e.message
      })
      .finally(() => {
        loading = false
      })
  })
</script>

<section class="page">
  <button type="button" class="back" onclick={() => navigate('/')}>← Back to explore</button>

  {#if loading}
    <p class="loading">Loading…</p>
  {:else if error}
    <p class="error">Error: {error}</p>
  {:else if country}
    <header class="hero">
      <span class="flag" aria-hidden="true">{country.flag_emoji}</span>
      <div class="title-block">
        <h1 class="name">{country.name}</h1>
        <p class="official">{country.official_name}</p>
      </div>
      <button
        type="button"
        class="compare-toggle"
        class:active={inCompare}
        onclick={() => onToggleCompare(country!.cca2)}
      >
        {inCompare ? '✓ In compare' : '+ Add to compare'}
      </button>
    </header>

    <div class="facts">
      <div class="fact">
        <span class="label">Capital</span>
        <span class="value">{country.capital}</span>
      </div>
      <div class="fact">
        <span class="label">Region</span>
        <span class="value">{country.region}</span>
      </div>
      <div class="fact">
        <span class="label">Subregion</span>
        <span class="value">{country.subregion}</span>
      </div>
      <div class="fact">
        <span class="label">Population</span>
        <span class="value">{country.population.toLocaleString()}</span>
      </div>
      <div class="fact">
        <span class="label">Area</span>
        <span class="value">{country.area_km2.toLocaleString()} km²</span>
      </div>
      <div class="fact">
        <span class="label">Density</span>
        <span class="value">{country.density?.toFixed(2) ?? '—'} / km²</span>
      </div>
      <div class="fact">
        <span class="label">Languages</span>
        <span class="value">{country.languages.join(', ')}</span>
      </div>
      <div class="fact">
        <span class="label">Currencies</span>
        <span class="value">{country.currencies.join(', ')}</span>
      </div>
    </div>

    {#if country.neighbors.length > 0}
      <section class="neighbors">
        <h2>Neighbors</h2>
        <div class="neighbor-row">
          {#each country.neighbors as code}
            <button type="button" class="neighbor" onclick={() => navigate(`/country/${code}`)}>
              {code}
            </button>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</section>

<style>
  .page {
    max-width: 880px;
    margin: 0 auto;
    padding: var(--space-10) var(--space-6);
  }

  .back {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin-bottom: var(--space-6);
    padding: var(--space-2) 0;
  }

  .back:hover {
    color: var(--accent);
  }

  .hero {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-8);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    margin-bottom: var(--space-8);
  }

  .flag {
    font-size: 5rem;
    line-height: 1;
  }

  .title-block {
    flex: 1;
  }

  .name {
    font-size: clamp(1.75rem, 4vw, 2.5rem);
    font-weight: var(--weight-bold);
    margin: 0 0 var(--space-1) 0;
    letter-spacing: -0.02em;
  }

  .official {
    color: var(--text-muted);
    margin: 0;
    font-size: 1rem;
  }

  .compare-toggle {
    padding: var(--space-3) var(--space-5);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    font-weight: var(--weight-medium);
    font-size: 0.9rem;
    transition: all var(--duration-fast) var(--easing-standard);
  }

  .compare-toggle:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .compare-toggle.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-on-accent);
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-10);
  }

  .fact {
    padding: var(--space-4) var(--space-5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
    font-weight: var(--weight-semibold);
  }

  .value {
    font-size: 1rem;
    color: var(--text);
    font-weight: var(--weight-medium);
  }

  .neighbors h2 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
    margin-bottom: var(--space-3);
  }

  .neighbor-row {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .neighbor {
    padding: var(--space-2) var(--space-4);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--text-muted);
    transition: all var(--duration-fast) var(--easing-standard);
  }

  .neighbor:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .loading,
  .error {
    text-align: center;
    padding: var(--space-12);
    color: var(--text-muted);
  }

  .error {
    color: var(--danger);
  }
</style>
