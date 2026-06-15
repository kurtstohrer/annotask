<!--
  Test-only target for agent-loop e2e tests. See the React sibling
  `AgentLoopTarget.tsx` for the full rationale. Only renders when the
  page is loaded with the `#agent-loop-target` hash.
-->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import './agent-loop-target.css'

const show = ref(
  typeof window !== 'undefined' && window.location.hash === '#agent-loop-target',
)

function update() {
  show.value = window.location.hash === '#agent-loop-target'
}

onMounted(() => window.addEventListener('hashchange', update))
onUnmounted(() => window.removeEventListener('hashchange', update))
</script>

<template>
  <section
    v-if="show"
    data-testid="agent-loop-target"
    aria-labelledby="agent-loop-target-heading"
  >
    <h2 id="agent-loop-target-heading">Agent-loop e2e target</h2>
    <p data-agent-loop-target="paragraph">Tracer element for agent-loop e2e tests.</p>
    <img
      data-agent-loop-target="image"
      src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3C/svg%3E"
      alt=""
      width="8"
      height="8"
    />
  </section>
</template>
