<template>
  <nav class="navbar">
    <div class="navbar-inner">
      <div class="brand">
        <span class="brand-icon">◈</span>
        <span class="brand-text">Mission Control</span>
        <span class="brand-tag">MFE</span>
      </div>
      <div class="nav-links">
        <router-link to="/dashboard">Dashboard</router-link>
        <router-link to="/planets">Planets</router-link>
        <router-link to="/moons">Moons</router-link>
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
</style>
