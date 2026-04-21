import '@annotask/stress-ui-tokens/tokens.css'
import '@mantine/core/styles.css'
import { bootstrapTheme } from '@annotask/stress-ui-tokens'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Root } from './Root'

bootstrapTheme()

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
