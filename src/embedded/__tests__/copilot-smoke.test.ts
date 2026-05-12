/**
 * Copilot end-to-end smoke test.
 *
 * Hits the real GitHub session-token endpoint and the real Copilot chat
 * endpoint. Catches GitHub-side contract drift (auth flow changes, response
 * shape changes, model name renames) so we find out before users do.
 *
 * Skipped by default. Enable with `ANNOTASK_COPILOT_SMOKE=1` once the local
 * machine has Copilot signed in (the smoke test reads
 * `~/.config/github-copilot/apps.json` like the provider does in production).
 *
 *   ANNOTASK_COPILOT_SMOKE=1 pnpm vitest run src/embedded/__tests__/copilot-smoke.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  CopilotProvider,
  exchangeOAuthForSessionToken,
  readOAuthToken,
} from '../copilot-provider'

const ENABLED = process.env.ANNOTASK_COPILOT_SMOKE === '1'
const describeIf = ENABLED ? describe : describe.skip

describeIf('Copilot smoke (real GitHub endpoints)', () => {
  it('exchanges an OAuth token for a Copilot session token', async () => {
    const oauth = await readOAuthToken()
    const session = await exchangeOAuthForSessionToken(oauth)
    expect(session.token).toMatch(/.+/)
    expect(session.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  }, 30_000)

  it('streams a trivial completion through the chat endpoint', async () => {
    const provider = new CopilotProvider({})
    const out: string[] = []
    let sawDone = false
    let sawUsage = false
    for await (const ev of provider.stream(
      [{ role: 'user', content: 'Reply with the single word "pong". No punctuation.' }],
      [],
      { systemPrompt: 'You are a terse echo bot.', model: 'gpt-4o-mini' },
    )) {
      if (ev.type === 'text') out.push(ev.text)
      if (ev.type === 'usage') sawUsage = true
      if (ev.type === 'done') sawDone = true
      if (ev.type === 'error') throw new Error(`Provider error: ${ev.error}`)
    }
    const joined = out.join('').trim().toLowerCase()
    expect(joined).toContain('pong')
    expect(sawDone).toBe(true)
    // Copilot usage reporting is occasionally absent; assert presence but
    // don't fail the smoke if GitHub omitted it.
    if (!sawUsage) console.warn('[smoke] Copilot did not return a usage chunk; check contract.')
  }, 60_000)
})
