/**
 * Test-only target for agent-loop e2e tests.
 *
 * Always mounted but visually inert by default. The e2e tests in
 * `playgrounds/stress-test/e2e/annotask/agent-loop/` mutate
 * `agent-loop-target.css` to drive a known style change through Vite
 * HMR and verify the round-trip. They also mutate this file to seed
 * a11y violations and console errors, then run the agent simulator
 * to apply a fix and restore the file in `afterEach`.
 *
 * The "Agent-loop e2e target" landmark only renders when the URL hash
 * is `#agent-loop-target` so it stays invisible in normal stress-test
 * use.
 */
import { useEffect, useState } from 'react'
import './agent-loop-target.css'

function useShowTarget(): boolean {
  const [show, setShow] = useState(
    typeof window !== 'undefined' && window.location.hash === '#agent-loop-target',
  )
  useEffect(() => {
    const handler = () => setShow(window.location.hash === '#agent-loop-target')
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  return show
}

export function AgentLoopTarget(): JSX.Element | null {
  const show = useShowTarget()
  if (!show) return null
  return (
    <section data-testid="agent-loop-target" aria-labelledby="agent-loop-target-heading">
      <h2 id="agent-loop-target-heading">Agent-loop e2e target</h2>
      <p data-agent-loop-target="paragraph">Tracer element for agent-loop e2e tests.</p>
      <img
        data-agent-loop-target="image"
        src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3C/svg%3E"
        alt=""
        width={8}
        height={8}
      />
    </section>
  )
}
