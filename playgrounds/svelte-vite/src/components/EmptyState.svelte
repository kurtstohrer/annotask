<script lang="ts">
  interface Props {
    title: string
    body?: string
    actionLabel?: string
    onaction?: () => void
  }

  let { title, body, actionLabel, onaction }: Props = $props()
</script>

<div class="empty">
  <div class="icon" aria-hidden="true">
    <svg width="56" height="56" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="2.5" fill="none" />
      <line x1="20" y1="32" x2="44" y2="32" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
      <line x1="32" y1="20" x2="32" y2="44" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    </svg>
  </div>
  <h3 class="title">{title}</h3>
  {#if body}<p class="body">{body}</p>{/if}
  {#if actionLabel && onaction}
    <button type="button" class="action" onclick={onaction}>{actionLabel}</button>
  {/if}
</div>

<style>
  .empty {
    padding: var(--space-16) var(--space-6);
    text-align: center;
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: var(--radius-lg);
  }

  .icon {
    color: var(--text-subtle);
    margin-bottom: var(--space-4);
    display: inline-flex;
  }

  .title {
    font-size: 1.25rem;
    font-weight: var(--weight-semibold);
    margin: 0 0 var(--space-2) 0;
    color: var(--text);
  }

  .body {
    color: var(--text-muted);
    margin: 0 0 var(--space-6) 0;
  }

  .action {
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--text-on-accent);
    font-weight: var(--weight-semibold);
    font-size: 0.95rem;
  }
</style>
