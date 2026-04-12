<script lang="ts">
  import { navigate } from '../lib/router.svelte'

  interface Props {
    currentPath: string
    compareCount: number
    theme: 'dark' | 'light'
    onToggleTheme: () => void
  }

  let { currentPath, compareCount, theme, onToggleTheme }: Props = $props()

  function go(path: string) {
    return (e: MouseEvent) => {
      e.preventDefault()
      navigate(path)
    }
  }

  const isExplore = $derived(currentPath === '/' || currentPath === '/country/:cca2')
  const isCompare = $derived(currentPath === '/compare')
</script>

<header class="header">
  <div class="inner">
    <a href="#/" class="brand" onclick={go('/')}>
      <span class="logo-mark" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="2.5" fill="none" />
          <ellipse cx="16" cy="16" rx="6" ry="14" stroke="currentColor" stroke-width="2" fill="none" />
          <line x1="2" y1="16" x2="30" y2="16" stroke="currentColor" stroke-width="2" />
        </svg>
      </span>
      <span class="brand-text">Atlas</span>
    </a>

    <nav class="nav" aria-label="Primary">
      <a
        href="#/"
        class="nav-link"
        class:active={isExplore}
        onclick={go('/')}
      >
        Explore
      </a>
      <a
        href="#/compare"
        class="nav-link"
        class:active={isCompare}
        onclick={go('/compare')}
      >
        Compare
        {#if compareCount > 0}
          <span class="badge">{compareCount}</span>
        {/if}
      </a>
    </nav>

    <div class="right">
      <span class="hint">Country data explorer</span>
      <button
        type="button"
        class="theme-toggle"
        onclick={onToggleTheme}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </div>
  </div>
</header>

<style>
  .header {
    position: sticky;
    top: 0;
    z-index: 50;
    background: var(--surface-glass);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--border);
  }

  .inner {
    max-width: var(--container-max);
    margin: 0 auto;
    padding: var(--space-4) var(--space-6);
    display: flex;
    align-items: center;
    gap: var(--space-8);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--text);
    font-weight: var(--weight-semibold);
    font-size: 1.15rem;
    letter-spacing: -0.01em;
  }

  .logo-mark {
    color: var(--accent);
    display: inline-flex;
    filter: drop-shadow(0 4px 12px var(--accent-glow));
  }

  .brand-text {
    font-family: var(--font-display);
  }

  .nav {
    display: flex;
    gap: var(--space-2);
    flex: 1;
    margin-left: var(--space-4);
  }

  .nav-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    font-size: 0.95rem;
    font-weight: var(--weight-medium);
    transition: all var(--duration-fast) var(--easing-standard);
  }

  .nav-link:hover {
    color: var(--text);
    background: var(--surface-2);
  }

  .nav-link.active {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--text-on-accent);
    font-size: 0.7rem;
    font-weight: var(--weight-bold);
  }

  .right {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .hint {
    font-size: 0.85rem;
    color: var(--text-subtle);
  }

  .theme-toggle {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 1rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all var(--duration-fast) var(--easing-standard);
  }

  .theme-toggle:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  @media (max-width: 640px) {
    .hint {
      display: none;
    }
  }
</style>
