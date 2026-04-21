<script lang="ts">
  interface Props {
    options: string[]
    value: string | null
    onselect: (value: string | null) => void
  }

  let { options, value, onselect }: Props = $props()
</script>

<div class="chips" role="group" aria-label="Region filter">
  <button
    type="button"
    class="chip"
    class:active={value === null}
    onclick={() => onselect(null)}
  >
    All regions
  </button>
  {#each options as option}
    <button
      type="button"
      class="chip"
      class:active={value === option}
      onclick={() => onselect(option)}
    >
      {option}
    </button>
  {/each}
</div>

<style>
  .chips {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .chip {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-pill);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: var(--weight-medium);
    transition: all var(--duration-fast) var(--easing-standard);
  }

  .chip:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .chip.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
