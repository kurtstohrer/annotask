import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Theme } from '@radix-ui/themes'
import '@radix-ui/themes/styles.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Theme appearance="dark" accentColor="blue" radius="medium">
      <App />
    </Theme>
  </BrowserRouter>
)
