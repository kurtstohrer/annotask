<script lang="ts">
  import type { Country } from '../lib/api'
  import { navigate } from '../lib/router.svelte'

  interface Props {
    country: Country
    inCompare: boolean
    onToggleCompare: (cca2: string) => void
  }

  let { country, inCompare, onToggleCompare }: Props = $props()

  function open() {
    navigate(`/country/${country.cca2}`)
  }

  function toggle(e: MouseEvent) {
    e.stopPropagation()
    onToggleCompare(country.cca2)
  }

  function regionClass(region: string): string {
    return `region-${region.toLowerCase()}`
  }
</script>

<div class="card-wrap">
  <button type="button" class="card" onclick={open} aria-label={`Open ${country.name}`}>
    <div class="head">
      <span class="flag" aria-hidden="true">{country.flag_emoji}</span>
    </div>

    <h3 class="name">{country.name}</h3>
    <p class="capital">{country.capital}</p>

    <div class="meta">
      <span class={`badge ${regionClass(country.region)}`}>{country.region}</span>
      <span class="population">{country.population.toLocaleString()}</span>
    </div>
  </button>

  <button
    type="button"
    class="compare-btn"
    class:active={inCompare}
    onclick={toggle}
    aria-label={inCompare ? `Remove ${country.name} from compare` : `Add ${country.name} to compare`}
  >
    {inCompare ? '✓' : '+'}
  </button>
</div>

<style>
  .card-wrap {
    position: relative;
  }

  .card {
    width: 100%;
    text-align: left;
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--duration-normal) var(--easing-standard);
    color: inherit;
    font: inherit;
  }

  .card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .head {
    display: flex;
    align-items: flex-start;
    margin-bottom: var(--space-3);
  }

  .flag {
    font-size: 2.25rem;
    line-height: 1;
  }

  .compare-btn {
    position: absolute;
    top: var(--space-4);
    right: var(--space-4);
    width: 32px;
    height: 32px;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 1.1rem;
    font-weight: var(--weight-bold);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all var(--duration-fast) var(--easing-standard);
    z-index: 1;
  }

  .compare-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .compare-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--text-on-accent);
  }

  .name {
    font-size: 1.05rem;
    font-weight: var(--weight-semibold);
    margin: 0 0 var(--space-1) 0;
    color: var(--text);
  }

  .capital {
    margin: 0 0 var(--space-4) 0;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }

  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }

  .badge {
    font-size: 0.7rem;
    font-weight: var(--weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
  }

  .badge.region-africa {
    background: color-mix(in srgb, var(--region-africa) 18%, transparent);
    color: var(--region-africa);
  }
  .badge.region-americas {
    background: color-mix(in srgb, var(--region-americas) 18%, transparent);
    color: var(--region-americas);
  }
  .badge.region-asia {
    background: color-mix(in srgb, var(--region-asia) 18%, transparent);
    color: var(--region-asia);
  }
  .badge.region-europe {
    background: color-mix(in srgb, var(--region-europe) 18%, transparent);
    color: var(--region-europe);
  }
  .badge.region-oceania {
    background: color-mix(in srgb, var(--region-oceania) 18%, transparent);
    color: var(--region-oceania);
  }

  .population {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--text-muted);
  }
</style>
