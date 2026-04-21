// single-spa lifecycle entry. Loaded cross-origin by the host at
// http://localhost:4210/src/single-spa.tsx. Keep this module side-effect
// free at evaluation time — mounting happens in mount() below.

import '@annotask/stress-ui-tokens/tokens.css'
import '@mantine/core/styles.css'
import { bootstrapTheme } from '@annotask/stress-ui-tokens'

import * as React from 'react'
import * as ReactDOMClient from 'react-dom/client'
import singleSpaReact from 'single-spa-react'
import { Root } from './Root'

bootstrapTheme()

const lifecycles = singleSpaReact({
  React,
  ReactDOMClient,
  rootComponent: Root,
  errorBoundary(err) {
    return <div style={{ padding: 24, color: 'crimson' }}>React MFE error: {String(err)}</div>
  },
})

export const bootstrap = lifecycles.bootstrap
export const mount = lifecycles.mount
export const unmount = lifecycles.unmount
