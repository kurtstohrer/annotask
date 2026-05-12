import '@annotask/stress-ui-tokens/tokens.css'
import { bootstrapTheme } from '@annotask/stress-ui-tokens'
import { createApp } from 'vue'
import App from './App.vue'
import AgentLoopTarget from './AgentLoopTarget.vue'

bootstrapTheme()

createApp(App).mount('#app')

// Agent-loop e2e target — only renders when the page hash is
// `#agent-loop-target`. Inert otherwise.
const agentLoopHost = document.createElement('div')
agentLoopHost.id = 'agent-loop-host'
document.body.appendChild(agentLoopHost)
createApp(AgentLoopTarget).mount(agentLoopHost)
