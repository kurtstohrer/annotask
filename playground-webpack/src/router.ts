import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/continents' },
  { path: '/continents', component: () => import('./pages/ContinentsPage.vue') },
  { path: '/oceans', component: () => import('./pages/OceansPage.vue') },
  { path: '/overview', component: () => import('./pages/OverviewPage.vue') },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
