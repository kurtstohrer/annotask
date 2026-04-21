<script lang="ts">
  import { getCountries, getRegions, type Country } from '../lib/api'
  import SearchBar from '../components/SearchBar.svelte'
  import FilterChips from '../components/FilterChips.svelte'
  import SortDropdown from '../components/SortDropdown.svelte'
  import CountryCard from '../components/CountryCard.svelte'
  import EmptyState from '../components/EmptyState.svelte'

  interface Props {
    compareCodes: string[]
    onToggleCompare: (cca2: string) => void
  }

  let { compareCodes, onToggleCompare }: Props = $props()

  let search = $state('')
  let region = $state<string | null>(null)
  let sortBy = $state<'name' | 'population' | 'area_km2'>('name')
  let sortDesc = $state(false)
  let countries = $state<Country[]>([])
  let regions = $state<string[]>([])
  let loading = $state(true)
  let error = $state('')

  $effect(() => {
    getRegions()
      .then((r) => {
        regions = r.regions.map((x) => x.region)
      })
      .catch(() => {})
  })

  // Re-fetch whenever filters change
  $effect(() => {
    loading = true
    error = ''
    getCountries({
      region: region ?? undefined,
      search: search || undefined,
      sort_by: sortBy,
      sort_desc: sortDesc,
    })
      .then((res) => {
        countries = res.countries
      })
      .catch((e) => {
        error = e.message
      })
      .finally(() => {
        loading = false
      })
  })

  function clearFilters() {
    search = ''
    region = null
    sortBy = 'name'
    sortDesc = false
  }

  const hasFilters = $derived(search !== '' || region !== null || sortBy !== 'name' || sortDesc)

  const sortOptions = [
    { value: 'name', label: 'Name' },
    { value: 'population', label: 'Population' },
    { value: 'area_km2', label: 'Area' },
  ]
</script>

<section class="page">
  <header class="page-header">
    <div>
      <h1 class="title">Explore countries</h1>
      <p class="lede">Filter by region, search by name, sort by population or area.</p>
    </div>
  </header>

  <div class="toolbar">
    <SearchBar value={search} onchange={(v) => (search = v)} />
    <SortDropdown
      options={sortOptions}
      value={sortBy}
      desc={sortDesc}
      onchange={(v, d) => {
        sortBy = v as 'name' | 'population' | 'area_km2'
        sortDesc = d
      }}
    />
  </div>

  <div class="filter-row">
    <FilterChips options={regions} value={region} onselect={(v) => (region = v)} />
  </div>

  <div class="result-meta">
    <span>{countries.length} countries</span>
    {#if hasFilters}
      <button type="button" class="clear" onclick={clearFilters}>Clear filters</button>
    {/if}
  </div>

  {#if loading}
    <p class="loading">Loading countries…</p>
  {:else if error}
    <p class="error">Error: {error}</p>
  {:else if countries.length === 0}
    <EmptyState
      title="No countries match your filters"
      body="Try clearing filters or broadening your search."
      actionLabel="Clear filters"
      onaction={clearFilters}
    />
  {:else}
    <div class="grid">
      {#each countries as country (country.cca2)}
        <CountryCard
          {country}
          inCompare={compareCodes.includes(country.cca2)}
          {onToggleCompare}
        />
      {/each}
    </div>
  {/if}
</section>

<style>
  .page {
    max-width: var(--container-max);
    margin: 0 auto;
    padding: var(--space-10) var(--space-6);
  }

  .page-header {
    margin-bottom: var(--space-8);
  }

  .title {
    font-size: clamp(1.75rem, 4vw, 2.5rem);
    font-weight: var(--weight-bold);
    margin: 0 0 var(--space-2) 0;
    letter-spacing: -0.02em;
  }

  .lede {
    color: var(--text-muted);
    margin: 0;
    font-size: 1.05rem;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
    flex-wrap: wrap;
  }

  .filter-row {
    margin-bottom: var(--space-5);
  }

  .result-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .clear {
    color: var(--accent);
    font-size: 0.9rem;
    font-weight: var(--weight-medium);
  }

  .clear:hover {
    color: var(--accent-strong);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-4);
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
