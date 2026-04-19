// single-spa lifecycle entry. Loaded cross-origin by the host at
// http://localhost:4220/src/single-spa.ts.

import '@annotask/stress-ui-tokens/tokens.css'
import { createApp, h } from 'vue'
import singleSpaVue from 'single-spa-vue'
import App from './App.vue'

const lifecycles = singleSpaVue({
  createApp,
  appOptions: {
    render() {
      return h(App)
    },
  },
})

export const bootstrap = lifecycles.bootstrap
export const mount = lifecycles.mount
export const unmount = lifecycles.unmount
