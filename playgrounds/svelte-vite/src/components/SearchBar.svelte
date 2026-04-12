<script lang="ts">
  interface Props {
    value: string
    placeholder?: string
    onchange: (value: string) => void
  }

  let { value, placeholder = 'Search countries…', onchange }: Props = $props()

  function handleInput(e: Event) {
    onchange((e.target as HTMLInputElement).value)
  }
</script>

<div class="search">
  <span class="icon" aria-hidden="true">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none" />
      <line x1="20" y1="20" x2="16.5" y2="16.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  </span>
  <input
    type="search"
    {value}
    {placeholder}
    oninput={handleInput}
    aria-label="Search countries"
  />
</div>

<style>
  .search {
    position: relative;
    flex: 1;
    min-width: 240px;
    max-width: 360px;
  }

  .icon {
    position: absolute;
    left: var(--space-4);
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-subtle);
    pointer-events: none;
  }

  input {
    width: 100%;
    padding: var(--space-3) var(--space-4) var(--space-3) calc(var(--space-4) + 26px);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    color: var(--text);
    font-size: 0.95rem;
    font-family: inherit;
    transition: border-color var(--duration-fast) var(--easing-standard);
  }

  input:focus {
    outline: none;
    border-color: var(--accent);
  }

  input::placeholder {
    color: var(--text-subtle);
  }
</style>
