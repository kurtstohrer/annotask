<script setup lang="ts">
defineProps<{ theme: 'dark' | 'light' }>()
defineEmits<{ 'toggle-theme': [] }>()
</script>

<template>
  <nav class="navbar">
    <div class="navbar-inner">
      <div class="brand">
        <span class="brand-icon">◈</span>
        <span class="brand-text">Storefront Widget</span>
        <span class="brand-tag">MFE</span>
      </div>
      <div class="nav-links">
        <router-link to="/dashboard">Overview</router-link>
        <router-link to="/products">Products</router-link>
        <router-link to="/categories">Categories</router-link>
        <button
          class="theme-toggle"
          @click="$emit('toggle-theme')"
          :aria-label="`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`"
        >
          {{ theme === 'dark' ? '☀' : '☾' }}
        </button>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.navbar {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 0 20px;
}
.navbar-inner {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 15px;
}
.brand-icon { color: var(--accent); font-size: 18px; }
.brand-tag {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: var(--accent-dim);
  color: var(--accent);
  padding: 2px 6px;
  border-radius: 4px;
}
.nav-links {
  display: flex;
  gap: 4px;
}
.nav-links a {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-dim);
  text-decoration: none;
  transition: all 0.15s;
}
.nav-links a:hover { color: var(--text); background: var(--surface-hover); }
.nav-links a.router-link-active {
  color: var(--accent);
  background: var(--accent-dim);
}

.theme-toggle {
  width: 28px;
  height: 28px;
  margin-left: 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-dim);
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.theme-toggle:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
