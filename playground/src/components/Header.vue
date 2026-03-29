<script setup lang="ts">
import { RouterLink } from 'vue-router'

defineProps<{ title: string }>()
</script>

<template>
  <header class="header">
    <div class="header-brand">
      <i class="pi pi-globe brand-icon"></i>
      <h1 class="brand-title">{{ title }}</h1>
    </div>
    <nav class="header-nav">
      <RouterLink to="/sun" class="nav-link">
        <i class="pi pi-sun"></i> Sun
      </RouterLink>
      <RouterLink to="/planets" class="nav-link">
        <i class="pi pi-globe"></i> Planets
      </RouterLink>
      <RouterLink to="/moons" class="nav-link">
        <i class="pi pi-moon"></i> Moons
      </RouterLink>
      <RouterLink to="/orbits" class="nav-link">
        <i class="pi pi-sun"></i> Orbits
      </RouterLink>
      <RouterLink to="/api-docs" class="nav-link">
        <i class="pi pi-book"></i> API Docs
      </RouterLink>
    </nav>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-icon {
  font-size: 20px;
  color: #9ca3af;
}

.brand-title {
  font-size: 18px;
  font-weight: 700;
  color: #f8fafc;
  letter-spacing: -0.02em;
}

.header-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  color: var(--text-muted);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s;
}

.nav-link:hover {
  background: var(--surface-alt);
  color: var(--text);
}

.nav-link.router-link-active {
  background: rgba(156, 163, 175, 0.1);
  color: #d1d5db;
}
</style>
