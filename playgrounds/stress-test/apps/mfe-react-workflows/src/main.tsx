import '@annotask/stress-ui-tokens/tokens.css'
import '@mantine/core/styles.css'
import { bootstrapTheme } from '@annotask/stress-ui-tokens'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Root } from './Root'
import { AgentLoopTarget } from './AgentLoopTarget'

bootstrapTheme()

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

// Agent-loop e2e target — only renders when the page hash is
// `#agent-loop-target`. Inert otherwise.
const agentLoopHost = document.createElement('div')
agentLoopHost.id = 'agent-loop-host'
document.body.appendChild(agentLoopHost)
createRoot(agentLoopHost).render(
  <StrictMode>
    <AgentLoopTarget />
  </StrictMode>,
)
