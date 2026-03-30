import { createRouter, createWebHistory } from 'vue-router'
import DashboardPage from './pages/DashboardPage.vue'
import PlanetsPage from './pages/PlanetsPage.vue'
import MoonsPage from './pages/MoonsPage.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: DashboardPage },
    { path: '/planets', component: PlanetsPage },
    { path: '/moons', component: MoonsPage },
  ],
})

export default router
