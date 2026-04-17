import { createApp } from 'vue'
import App from './App.vue'

// Global shell styles (modularized from App.vue)
import './_toolbar.css'
import './_canvas.css'
import './_panels.css'
import './_highlights.css'
import './_tasks.css'
import './_a11y.css'
import './_overlays.css'

createApp(App).mount('#app')
