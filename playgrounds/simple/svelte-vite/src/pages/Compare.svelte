<script lang="ts">
  import { compareCountries, type Country } from '../lib/api'
  import { navigate } from '../lib/router.svelte'
  import CompareTable from '../components/CompareTable.svelte'
  import EmptyState from '../components/EmptyState.svelte'

  interface Props {
    codes: string[]
    onClear: () => void
    onRemove: (cca2: string) => void
  }

  let { codes, onClear, onRemove }: Props = $props()

  let countries = $state<Country[]>([])
  let loading = $state(false)
  let error = $state('')

  $effect(() => {
    if (codes.length === 0) {
      countries = []
      return
    }
    loading = true
    error = ''
    compareCountries(codes)
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
</script>

<section class="page">
  <header class="page-header">
    <div>
      <h1 class="title">Compare countries</h1>
      <p class="lede">Side-by-side stats for up to four countries.</p>
    </div>
    {#if codes.length > 0}
      <button type="button" class="clear" onclick={onClear}>Clear all</button>
    {/if}
  </header>

  {#if codes.length === 0}
    <EmptyState
      title="No countries selected"
      body="Add countries from the explorer (look for the + button on each card)."
      actionLabel="Open explorer"
      onaction={() => navigate('/')}
    />
  {:else if loading}
    <p class="status">Loading…</p>
  {:else if error}
    <p class="status error">Error: {error}</p>
  {:else}
    <div class="chips">
      {#each countries as c}
        <button
          type="button"
          class="chip"
          onclick={() => onRemove(c.cca2)}
          aria-label={`Remove ${c.name} from compare`}
        >
          {c.flag_emoji}
          {c.name}
          <span class="x">×</span>
        </button>
      {/each}
    </div>
    <CompareTable {countries} />
  {/if}
</section>

<style>
  .page {
    max-width: var(--container-max);
    margin: 0 auto;
    padding: var(--space-10) var(--space-6);
  }

  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
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

  .clear {
    padding: var(--space-2) var(--space-4);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .clear:hover {
    color: var(--danger);
    border-color: var(--danger);
  }

  .chips {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-6);
    flex-wrap: wrap;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    border-radius: var(--radius-pill);
    color: var(--accent);
    font-size: 0.9rem;
    font-weight: var(--weight-medium);
  }

  .chip .x {
    margin-left: var(--space-1);
    font-size: 1.1rem;
    line-height: 1;
  }

  .chip:hover {
    background: color-mix(in srgb, var(--accent) 26%, transparent);
  }

  .status {
    text-align: center;
    padding: var(--space-12);
    color: var(--text-muted);
  }

  .status.error {
    color: var(--danger);
  }
</style>
