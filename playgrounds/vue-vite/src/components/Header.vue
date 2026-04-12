<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'

defineProps<{ title: string; theme: 'dark' | 'light' }>()
defineEmits<{ 'toggle-theme': [] }>()

const menuOpen = ref(false)
</script>

<template>
  <header class="header">
    <div class="header-brand">
      <i class="pi pi-chart-line brand-icon"></i>
      <h1 class="brand-title">{{ title }}</h1>
    </div>
    <button class="menu-toggle" @click="menuOpen = !menuOpen" aria-label="Toggle menu">
      <i :class="menuOpen ? 'pi pi-times' : 'pi pi-bars'"></i>
    </button>
    <nav class="header-nav" :class="{ open: menuOpen }">
      <RouterLink to="/overview" class="nav-link" @click="menuOpen = false">
        <i class="pi pi-th-large"></i> Overview
      </RouterLink>
      <RouterLink to="/users" class="nav-link" @click="menuOpen = false">
        <i class="pi pi-users"></i> Users
      </RouterLink>
      <RouterLink to="/orders" class="nav-link" @click="menuOpen = false">
        <i class="pi pi-shopping-cart"></i> Orders
      </RouterLink>
      <RouterLink to="/analytics" class="nav-link" @click="menuOpen = false">
        <i class="pi pi-chart-bar"></i> Analytics
      </RouterLink>
      <RouterLink to="/api-docs" class="nav-link" @click="menuOpen = false">
        <i class="pi pi-book"></i> API Docs
      </RouterLink>
    </nav>
    <button
      class="theme-toggle"
      @click="$emit('toggle-theme')"
      :aria-label="`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`"
    >
      <i :class="theme === 'dark' ? 'pi pi-sun' : 'pi pi-moon'"></i>
    </button>
  </header>
</template>

<style scoped>
.header {
  position: relative;
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
  color: var(--text);
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
  background: var(--surface-alt);
  color: var(--text);
}

.menu-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 20px;
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  transition: all 0.15s;
}

.menu-toggle:hover {
  background: var(--surface-alt);
  color: var(--text);
}

.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-left: 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s;
}

.theme-toggle:hover {
  border-color: var(--text-muted);
  color: var(--text);
}

@media (max-width: 768px) {
  .brand-title {
    display: none;
  }

  .menu-toggle {
    display: flex;
  }

  .header-nav {
    display: none;
    position: absolute;
    top: 56px;
    left: 0;
    right: 0;
    flex-direction: column;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 8px;
    z-index: 100;
  }

  .header-nav.open {
    display: flex;
  }
}
</style>
