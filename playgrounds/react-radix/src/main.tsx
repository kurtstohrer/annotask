import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Theme } from '@radix-ui/themes'
import '@radix-ui/themes/styles.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Theme appearance="dark" accentColor="iris" radius="medium">
      <App />
    </Theme>
  </StrictMode>,
)
