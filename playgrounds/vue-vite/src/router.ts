import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/overview' },
    { path: '/overview', component: () => import('./pages/OverviewPage.vue') },
    { path: '/users', component: () => import('./pages/UsersPage.vue') },
    { path: '/orders', component: () => import('./pages/OrdersPage.vue') },
    { path: '/analytics', component: () => import('./pages/AnalyticsPage.vue') },
    { path: '/api-docs', component: () => import('./pages/ApiDocsPage.vue') },
  ],
})

export default router
