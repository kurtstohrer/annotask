import { createApp } from 'vue'
import App from './App.vue'

// Global shell styles (modularized from App.vue)
import './styles/_toolbar.css'
import './styles/_canvas.css'
import './styles/_panels.css'
import './styles/_highlights.css'
import './styles/_tasks.css'
import './styles/_a11y.css'
import './styles/_overlays.css'

createApp(App).mount('#app')
