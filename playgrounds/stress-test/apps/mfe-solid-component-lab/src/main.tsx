import '@annotask/stress-ui-tokens/tokens.css'
import './app.css'
import { bootstrapTheme } from '@annotask/stress-ui-tokens'
import { render } from 'solid-js/web'
import { App } from './App'

bootstrapTheme()

render(() => <App />, document.getElementById('app')!)
