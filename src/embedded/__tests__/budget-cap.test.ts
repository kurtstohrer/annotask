import { describe, it, expect } from 'vitest'
import {
  BudgetCap,
  BudgetCapExceeded,
  pricerFromRateCard,
  type BudgetPricer,
} from '../budget-cap.js'

// Simple linear pricer: $1 per 1k input tokens, $2 per 1k output. Easy
// math for assertions.
const flatPricer: BudgetPricer = ({ input, output }) =>
  (input / 1000) * 1 + (output / 1000) * 2

describe('BudgetCap', () => {
  it('starts at zero', () => {
    const b = new BudgetCap({ capUsd: 1, pricer: flatPricer })
    const s = b.snapshot()
    expect(s.totalUsd).toBe(0)
    expect(s.remainingUsd).toBe(1)
    expect(s.exceeded).toBe(false)
    expect(s.ratio).toBe(0)
  })

  it('accumulates usage and reports running total', () => {
    const b = new BudgetCap({ capUsd: 10, pricer: flatPricer })
    b.accumulate({ input: 500, output: 250 })
    const s = b.snapshot()
    // 0.5 + 0.5 = 1.0
    expect(s.totalUsd).toBeCloseTo(1.0, 6)
    expect(s.remainingUsd).toBeCloseTo(9.0, 6)
    expect(s.exceeded).toBe(false)
    expect(s.ratio).toBeCloseTo(0.1, 6)
  })

  it('flips exceeded when total crosses cap', () => {
    const b = new BudgetCap({ capUsd: 1, pricer: flatPricer })
    const a = b.accumulate({ input: 400, output: 200 })
    expect(a.exceeded).toBe(false)
    const c = b.accumulate({ input: 400, output: 200 })
    // After two turns: input=800, output=400 → $0.8 + $0.8 = $1.6
    expect(c.totalUsd).toBeCloseTo(1.6, 6)
    expect(c.exceeded).toBe(true)
    expect(c.remainingUsd).toBe(0)
    expect(c.ratio).toBe(1)
  })

  it('shouldStop stays true after a single breach (sticky)', () => {
    const b = new BudgetCap({ capUsd: 0.1, pricer: flatPricer })
    b.accumulate({ input: 1000, output: 0 })
    expect(b.shouldStop()).toBe(true)
    // Even if a follow-up turn arrives with zero usage, we stay stopped
    // until reset(). The runner must call reset() between conversations.
    b.accumulate({ input: 0, output: 0 })
    expect(b.shouldStop()).toBe(true)
  })

  it('enforce() throws BudgetCapExceeded with the snapshot details', () => {
    const b = new BudgetCap({ capUsd: 0.5, pricer: flatPricer })
    b.accumulate({ input: 1000, output: 0 })
    try {
      b.enforce()
      throw new Error('enforce did not throw')
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetCapExceeded)
      const err = e as BudgetCapExceeded
      expect(err.capUsd).toBe(0.5)
      expect(err.totalUsd).toBeCloseTo(1.0, 6)
    }
  })

  it('reset() clears state', () => {
    const b = new BudgetCap({ capUsd: 0.1, pricer: flatPricer })
    b.accumulate({ input: 1000, output: 0 })
    expect(b.shouldStop()).toBe(true)
    b.reset()
    const s = b.snapshot()
    expect(s.totalUsd).toBe(0)
    expect(s.exceeded).toBe(false)
    expect(s.totals).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  })

  it('clamps negative and non-finite inputs to zero', () => {
    const b = new BudgetCap({ capUsd: 1, pricer: flatPricer })
    b.accumulate({ input: -100, output: Number.NaN })
    b.accumulate({ input: 500, output: 250 })
    expect(b.snapshot().totalUsd).toBeCloseTo(1.0, 6)
  })

  it('rejects non-positive cap values', () => {
    expect(() => new BudgetCap({ capUsd: 0, pricer: flatPricer })).toThrow()
    expect(() => new BudgetCap({ capUsd: -1, pricer: flatPricer })).toThrow()
    expect(
      () => new BudgetCap({ capUsd: Number.NaN, pricer: flatPricer }),
    ).toThrow()
    expect(
      () => new BudgetCap({ capUsd: Number.POSITIVE_INFINITY, pricer: flatPricer }),
    ).toThrow()
  })

  it('tracks cache read/write buckets independently', () => {
    const b = new BudgetCap({ capUsd: 10, pricer: flatPricer })
    b.accumulate({ input: 100, output: 50, cacheRead: 200, cacheWrite: 25 })
    const s = b.snapshot()
    expect(s.totals.cacheRead).toBe(200)
    expect(s.totals.cacheWrite).toBe(25)
  })

  it('ratio is exactly 1 at the cap boundary', () => {
    const b = new BudgetCap({ capUsd: 1, pricer: flatPricer })
    // 500 input + 250 output → exactly $1.00.
    b.accumulate({ input: 500, output: 250 })
    const s = b.snapshot()
    expect(s.totalUsd).toBeCloseTo(1.0, 6)
    expect(s.exceeded).toBe(true)
    expect(s.ratio).toBe(1)
  })
})

describe('pricerFromRateCard', () => {
  it('matches the Anthropic 10% cache-read / 125% cache-write convention', () => {
    const pricer = pricerFromRateCard({ inputPerMTok: 3, outputPerMTok: 15 })
    const cost = pricer({
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
    })
    // 3 + 15 + 0.3 + 3.75 = 22.05
    expect(cost).toBeCloseTo(22.05, 6)
  })

  it('returns 0 for zero usage', () => {
    const pricer = pricerFromRateCard({ inputPerMTok: 3, outputPerMTok: 15 })
    expect(pricer({ input: 0, output: 0 })).toBe(0)
  })
})
