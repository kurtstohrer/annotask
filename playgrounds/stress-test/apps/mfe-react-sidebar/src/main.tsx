import '@annotask/stress-ui-tokens/tokens.css'
import '@radix-ui/themes/styles.css'
import { bootstrapTheme } from '@annotask/stress-ui-tokens'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

bootstrapTheme()

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <div style={{ height: '100vh', width: 'var(--stress-sidebar-width, 260px)' }}>
      <App />
    </div>
  </StrictMode>,
)
