import '@annotask/stress-ui-tokens/tokens.css'
import './app.css'
import { bootstrapTheme } from '@annotask/stress-ui-tokens'
import { mount } from 'svelte'
import App from './App.svelte'

bootstrapTheme()

mount(App, { target: document.getElementById('app') })
