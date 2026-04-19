// single-spa lifecycle entry for Solid. Loaded cross-origin by the host
// at http://localhost:4240/src/single-spa.tsx.

import '@annotask/stress-ui-tokens/tokens.css'
import './app.css'
import { render } from 'solid-js/web'
import { App } from './App'

let dispose: (() => void) | null = null

export async function bootstrap() {}

export async function mount(props: { name: string }) {
  const target = document.getElementById(`single-spa-application:${props.name}`)
  if (!target) throw new Error('[solid-component-lab] mount target not found')
  dispose = render(() => <App />, target)
}

export async function unmount() {
  if (dispose) {
    dispose()
    dispose = null
  }
}
