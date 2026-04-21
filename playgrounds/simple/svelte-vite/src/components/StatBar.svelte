<script lang="ts">
  interface Props {
    value: number
    max: number
    label?: string
    color?: string
  }

  let { value, max, label, color = 'var(--accent)' }: Props = $props()

  const pct = $derived(max > 0 ? Math.min(100, (value / max) * 100) : 0)
</script>

<div class="bar-row">
  {#if label}
    <span class="label">{label}</span>
  {/if}
  <div class="track">
    <div class="fill" style="width: {pct}%; background: {color};"></div>
  </div>
  <span class="value">{value.toLocaleString()}</span>
</div>

<style>
  .bar-row {
    display: grid;
    grid-template-columns: 90px 1fr 100px;
    align-items: center;
    gap: var(--space-3);
  }

  .label {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-weight: var(--weight-medium);
  }

  .track {
    height: 8px;
    background: var(--surface-2);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: var(--radius-pill);
    transition: width var(--duration-normal) var(--easing-standard);
  }

  .value {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    color: var(--text);
    text-align: right;
  }
</style>
