import { createRouter, createWebHistory } from 'vue-router'
import PlanetsPage from './pages/PlanetsPage.vue'
import MoonsPage from './pages/MoonsPage.vue'
import SunPage from './pages/SunPage.vue'
import OrbitalPage from './pages/OrbitalPage.vue'
import ApiDocsPage from './pages/ApiDocsPage.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/planets' },
    { path: '/planets', component: PlanetsPage },
    { path: '/moons', component: MoonsPage },
    { path: '/sun', component: SunPage },
    { path: '/orbits', component: OrbitalPage },
    { path: '/api-docs', component: ApiDocsPage },
  ],
})

export default router
