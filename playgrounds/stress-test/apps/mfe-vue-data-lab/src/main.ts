import '@annotask/stress-ui-tokens/tokens.css'
import { bootstrapTheme } from '@annotask/stress-ui-tokens'
import { createApp } from 'vue'
import App from './App.vue'

bootstrapTheme()

createApp(App).mount('#app')
