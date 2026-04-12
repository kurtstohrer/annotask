import { createRouter, createWebHistory } from 'vue-router'
import DashboardPage from './pages/DashboardPage.vue'
import ProductsPage from './pages/ProductsPage.vue'
import CategoriesPage from './pages/CategoriesPage.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: DashboardPage },
    { path: '/products', component: ProductsPage },
    { path: '/categories', component: CategoriesPage },
  ],
})

export default router
