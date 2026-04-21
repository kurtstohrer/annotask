// single-spa lifecycle entry for the sidebar MFE. Loaded cross-origin by
// the host at http://localhost:4250/src/single-spa.tsx. The sidebar
// `activeWhen: () => true` in the host — it stays mounted on every
// route.

import '@annotask/stress-ui-tokens/tokens.css'
import '@radix-ui/themes/styles.css'
import { bootstrapTheme } from '@annotask/stress-ui-tokens'

import * as React from 'react'
import * as ReactDOMClient from 'react-dom/client'
import singleSpaReact from 'single-spa-react'
import { App } from './App'

bootstrapTheme()

const lifecycles = singleSpaReact({
  React,
  ReactDOMClient,
  rootComponent: App,
  errorBoundary(err) {
    return (
      <div style={{ padding: 16, color: 'crimson', fontSize: 13 }}>
        Sidebar MFE error: {String(err)}
      </div>
    )
  },
})

export const bootstrap = lifecycles.bootstrap
export const mount = lifecycles.mount
export const unmount = lifecycles.unmount
