<script lang="ts">
  interface Props {
    currentPage: string
    onNavigate: (page: string) => void
  }

  let { currentPage, onNavigate }: Props = $props()

  const navItems = [
    { id: 'planets', label: 'Planets', icon: 'planets' },
    { id: 'moons', label: 'Moons', icon: 'moons' },
    { id: 'stats', label: 'Stats', icon: 'stats' },
  ]
</script>

<header class="header">
  <div class="header-inner">
    <div class="logo">
      <span class="logo-icon">&#9790;</span>
      <h1 class="logo-text">Planet Explorer</h1>
    </div>
    <nav class="nav">
      {#each navItems as item}
        <button
          class="nav-btn"
          class:active={currentPage === item.id}
          onclick={() => onNavigate(item.id)}
        >
          {#if item.icon === 'planets'}
            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="16" ry="4" transform="rotate(-30 12 12)"/></svg>
          {:else if item.icon === 'moons'}
            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          {:else if item.icon === 'stats'}
            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          {/if}
          {item.label}
        </button>
      {/each}
    </nav>
  </div>
</header>

<style>
  .header {
    background-color: #271d2f;
    border-bottom: 1px solid #2e1c4f;
    padding: 0 2rem;
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header-inner {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 64px;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .logo-icon {
    font-size: 1.75rem;
    color: #7020b1;
  }

  .logo-text {
    font-size: 1.25rem;
    font-weight: 600;
    color: #e2e8f0;
    margin: 0;
  }

  .nav {
    display: flex;
    gap: 0.5rem;
  }

  .nav-btn {
    background: transparent;
    border: 1px solid transparent;
    color: #8899aa;
    padding: 0.5rem 1.25rem;
    border-radius: 6px;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .nav-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .nav-btn:hover {
    color: #c8d6e5;
    background-color: #162d50;
    border-color: #2e1c4f;
  }

  .nav-btn.active {
    color: #7020b1;
    background-color: #6a6b43;
    border-color: #1e1330;
  }
</style>
