// single-spa lifecycle entry for Svelte 5. Loaded cross-origin by the
// host at http://localhost:4230/src/single-spa.js.

import '@annotask/stress-ui-tokens/tokens.css'
import './app.css'
import { mount as svelteMount, unmount as svelteUnmount } from 'svelte'
import App from './App.svelte'

let instance = null

export async function bootstrap() {}

export async function mount(props) {
  const target = document.getElementById(`single-spa-application:${props.name}`)
  if (!target) throw new Error(`[svelte-streaming] mount target not found`)
  instance = svelteMount(App, { target })
}

export async function unmount() {
  if (instance) {
    await svelteUnmount(instance)
    instance = null
  }
}
