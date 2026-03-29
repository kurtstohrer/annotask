<script lang="ts">
  import Header from './components/Header.svelte'
  import PlanetsPage from './components/PlanetsPage.svelte'
  import MoonsPage from './components/MoonsPage.svelte'
  import StatsPage from './components/StatsPage.svelte'

  let currentPage = $state('planets')

  function navigate(page: string) {
    currentPage = page
  }
</script>

<div class="app">
  <Header {currentPage} onNavigate={navigate} />
  <main class="content">
    {#if currentPage === 'planets'}
      <PlanetsPage />
    {:else if currentPage === 'moons'}
      <MoonsPage />
    {:else if currentPage === 'stats'}
      <StatsPage />
    {/if}
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
      Ubuntu, Cantarell, sans-serif;
    background-color: #161718;
    color: #c8d6e5;
  }

  :global(*) {
    box-sizing: border-box;
  }

  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .content {
    flex: 1;
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
  }
</style>
