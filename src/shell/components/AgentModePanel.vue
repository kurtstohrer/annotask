<script setup lang="ts">
/**
 * Agent-mode panel — extracted from ProviderSettingsPanel to live on the
 * General settings tab. Three-state global toggle controlling how
 * aggressively the in-shell agent fires:
 *   - `auto`   — every new task auto-opens its Conversation tab and runs
 *   - `manual` — Conversation tab available; agent runs on user click
 *   - `off`    — no in-shell chat surface; drive via terminal/MCP
 */
import { computed } from 'vue'
import { useProviderSettings } from '../composables/useProviderSettings'
import { useAgentDetect } from '../composables/useTaskThread'
import { AGENT_MODES, isActiveProviderReady, type AgentMode, type LocalCliReadiness } from '../../embedded/provider-config'

const store = useProviderSettings()
const settings = store.settings
const detect = useAgentDetect()

const localReadiness = computed<LocalCliReadiness>(() => {
  const snap = detect.snapshot.value
  if (!snap) return {}
  return {
    'claude-local': snap['claude-local']?.found === true && snap['claude-local']?.loggedIn === true,
    'codex-local': snap['codex-local']?.found === true && snap['codex-local']?.loggedIn === true,
    'opencode-local': snap['opencode-local']?.found === true && snap['opencode-local']?.loggedIn === true,
    'copilot-local': snap['copilot-local']?.found === true && snap['copilot-local']?.loggedIn === true,
  }
})
const activeReady = computed(() => isActiveProviderReady(settings.value, localReadiness.value))

const AGENT_MODE_DESCRIPTIONS: Record<AgentMode, string> = {
  auto: 'Tasks auto-run on create. The agent opens the Conversation tab and starts immediately.',
  manual: 'Conversation tab is available, but the agent only runs when you click Run-with-agent on a task.',
  off: 'No in-shell chat surface. Drive agents from the terminal via MCP, the annotask CLI, or the /annotask-apply skill.',
}

function setAgentMode(mode: AgentMode) {
  store.setAgentMode(mode)
}
</script>

<template>
  <div class="agent-mode-panel">
    <p class="agent-mode-desc">
      Controls how aggressive the in-shell agent is when you create a task.
    </p>
    <div class="agent-mode-strip" role="radiogroup" aria-label="Agent mode">
      <button
        v-for="mode in AGENT_MODES"
        :key="mode"
        type="button"
        role="radio"
        :aria-checked="settings.agentMode === mode"
        :class="['agent-mode-btn', { active: settings.agentMode === mode }]"
        :data-testid="`agent-mode-${mode}`"
        :disabled="mode !== 'off' && !activeReady"
        @click="setAgentMode(mode)"
      >
        {{ mode }}
      </button>
    </div>
    <p class="agent-mode-hint">{{ AGENT_MODE_DESCRIPTIONS[settings.agentMode] }}</p>
    <p v-if="!activeReady && settings.agentMode !== 'off'" class="agent-mode-hint tone-warning">
      Configure a CLI provider in LLM Providers to use auto or manual mode.
    </p>
  </div>
</template>

<style scoped>
.agent-mode-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agent-mode-desc {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}
.agent-mode-strip {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 7px;
  align-self: flex-start;
}
.agent-mode-btn {
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 14px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 5px;
  cursor: pointer;
  text-transform: lowercase;
}
.agent-mode-btn:hover:not(.active):not(:disabled) { color: var(--text); }
.agent-mode-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.agent-mode-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.agent-mode-btn.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 3px var(--shadow);
}
.agent-mode-hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.45;
}
.agent-mode-hint.tone-warning { color: var(--warning); }
</style>
