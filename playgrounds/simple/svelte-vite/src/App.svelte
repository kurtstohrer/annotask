<script lang="ts">
  import './app.css'
  import Header from './components/Header.svelte'
  import CountryList from './pages/CountryList.svelte'
  import CountryDetail from './pages/CountryDetail.svelte'
  import Compare from './pages/Compare.svelte'
  import { createRouter } from './lib/router.svelte'
  import { createCompareStore } from './lib/compareStore.svelte'
  import { createThemeStore } from './lib/theme.svelte'

  const router = createRouter()
  const compare = createCompareStore()
  const theme = createThemeStore()

  function toggleCompare(cca2: string) {
    compare.toggle(cca2)
  }
</script>

<Header
  currentPath={router.current.path}
  compareCount={compare.count}
  theme={theme.value}
  onToggleTheme={() => theme.toggle()}
/>

<main class="app">
  {#if router.current.path === '/'}
    <CountryList compareCodes={compare.codes} onToggleCompare={toggleCompare} />
  {:else if router.current.path === '/country/:cca2'}
    <CountryDetail
      cca2={router.current.params.cca2}
      inCompare={compare.has(router.current.params.cca2)}
      onToggleCompare={toggleCompare}
    />
  {:else if router.current.path === '/compare'}
    <Compare
      codes={compare.codes}
      onClear={() => compare.clear()}
      onRemove={(c) => compare.remove(c)}
    />
  {/if}
</main>

<style>
  .app {
    flex: 1;
  }
</style>
