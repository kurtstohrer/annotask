<script lang="ts">
  interface SortOption {
    value: string
    label: string
  }

  interface Props {
    options: SortOption[]
    value: string
    desc: boolean
    onchange: (value: string, desc: boolean) => void
  }

  let { options, value, desc, onchange }: Props = $props()

  function handleSortBy(e: Event) {
    onchange((e.target as HTMLSelectElement).value, desc)
  }

  function toggleDir() {
    onchange(value, !desc)
  }
</script>

<div class="sort">
  <label class="label">
    Sort
    <select {value} onchange={handleSortBy}>
      {#each options as option}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </label>
  <button type="button" class="dir" onclick={toggleDir} aria-label="Toggle sort direction">
    {desc ? '↓' : '↑'}
  </button>
</div>

<style>
  .sort {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.85rem;
    color: var(--text-muted);
    font-weight: var(--weight-medium);
  }

  select {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    padding: var(--space-2) var(--space-3);
    font-size: 0.9rem;
    font-family: inherit;
    cursor: pointer;
  }

  select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .dir {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 1rem;
    font-weight: var(--weight-bold);
    transition: all var(--duration-fast) var(--easing-standard);
  }

  .dir:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
