import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/planets' },
    { path: '/planets', component: () => import('./pages/PlanetsPage.vue') },
    { path: '/moons', component: () => import('./pages/MoonsPage.vue') },
    { path: '/sun', component: () => import('./pages/SunPage.vue') },
    { path: '/orbits', component: () => import('./pages/OrbitalPage.vue') },
    { path: '/api-docs', component: () => import('./pages/ApiDocsPage.vue') },
  ],
})

export default router
