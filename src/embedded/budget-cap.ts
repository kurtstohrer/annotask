/**
 * Per-conversation budget cap.
 *
 * The embedded chat loop is BYOK and runs locally — the only thing that
 * stops a runaway tool-using loop is the cap configured here. We enforce it
 * defensively after every provider turn (token-based, before money is
 * counted) and surface a structured stop reason the runner can render in
 * the UI without ambiguity.
 *
 * Model:
 * - The cap is denominated in USD. The runner converts token counts to USD
 *   via a `pricer` callback (kept injectable so different providers can
 *   plug in their own rate cards without this module knowing them).
 * - We accumulate input + output (+ optional cache buckets) into a running
 *   total. Every accumulate() call returns whether the cap is now breached,
 *   so the runner can short-circuit before the next provider turn.
 * - `state` is never negative; clamping is done at the input edge.
 *
 * Hard-stop semantics:
 * - Once breached, `shouldStop()` stays true until `reset()`. The runner
 *   MUST abort the in-flight turn and emit a terminal event with reason
 *   `cap_exceeded` so the UI can show the cap card.
 */

export interface BudgetUsage {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export interface BudgetPricer {
  /** Convert a usage tally into USD. Must be pure. */
  (usage: BudgetUsage): number
}

export interface BudgetCapOptions {
  /** Hard cap in USD. Must be > 0. */
  capUsd: number
  /** Pricer that maps usage → USD. */
  pricer: BudgetPricer
}

export interface BudgetSnapshot {
  totalUsd: number
  capUsd: number
  /** True iff `totalUsd >= capUsd`. */
  exceeded: boolean
  /** Remaining USD before the cap. Never negative. */
  remainingUsd: number
  /** % of cap consumed (0..1). Saturates at 1. */
  ratio: number
  totals: Required<BudgetUsage>
}

export class BudgetCapExceeded extends Error {
  readonly capUsd: number
  readonly totalUsd: number
  constructor(snapshot: BudgetSnapshot) {
    super(
      `Budget cap exceeded: $${snapshot.totalUsd.toFixed(4)} spent of $${snapshot.capUsd.toFixed(2)} cap.`,
    )
    this.name = 'BudgetCapExceeded'
    this.capUsd = snapshot.capUsd
    this.totalUsd = snapshot.totalUsd
  }
}

/**
 * Conversation-scoped budget tracker. One instance per task/conversation.
 *
 * Usage:
 * ```ts
 * const budget = new BudgetCap({ capUsd: 0.5, pricer })
 * for await (const turn of loop) {
 *   const snap = budget.accumulate(turn.usage)
 *   if (snap.exceeded) {
 *     yield { kind: 'done', reason: 'cap_exceeded' }
 *     return
 *   }
 * }
 * ```
 */
export class BudgetCap {
  private readonly capUsd: number
  private readonly pricer: BudgetPricer
  private totals: Required<BudgetUsage> = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  }

  constructor(options: BudgetCapOptions) {
    if (!(options.capUsd > 0) || !Number.isFinite(options.capUsd)) {
      throw new Error(`BudgetCap: capUsd must be a positive finite number, got ${options.capUsd}`)
    }
    this.capUsd = options.capUsd
    this.pricer = options.pricer
  }

  /**
   * Add usage from a single provider turn to the running total and return
   * the new snapshot. The caller decides what to do when `exceeded` flips
   * true; this class does not throw on accumulate.
   */
  accumulate(usage: BudgetUsage): BudgetSnapshot {
    this.totals = {
      input: this.totals.input + clamp(usage.input),
      output: this.totals.output + clamp(usage.output),
      cacheRead: this.totals.cacheRead + clamp(usage.cacheRead ?? 0),
      cacheWrite: this.totals.cacheWrite + clamp(usage.cacheWrite ?? 0),
    }
    return this.snapshot()
  }

  /**
   * Throw `BudgetCapExceeded` if the cap is breached. Convenience for
   * runners that prefer an exception over a sentinel return value.
   */
  enforce(): void {
    const snap = this.snapshot()
    if (snap.exceeded) throw new BudgetCapExceeded(snap)
  }

  shouldStop(): boolean {
    return this.snapshot().exceeded
  }

  snapshot(): BudgetSnapshot {
    const totalUsd = this.pricer(this.totals)
    const cap = this.capUsd
    const exceeded = totalUsd >= cap
    const remainingUsd = Math.max(0, cap - totalUsd)
    const ratio = cap === 0 ? 1 : Math.min(1, totalUsd / cap)
    return {
      totalUsd,
      capUsd: cap,
      exceeded,
      remainingUsd,
      ratio,
      totals: { ...this.totals },
    }
  }

  reset(): void {
    this.totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  }
}

function clamp(n: number | undefined): number {
  if (n == null || !Number.isFinite(n) || n < 0) return 0
  return n
}

/**
 * Pricer factory matching the embedded-agent pricing module. Kept here so
 * tests don't need to import the UI-shell pricing module — callers in the
 * shell can pass `priceUsage`'s output directly through their own thin
 * wrapper if they prefer.
 */
export function pricerFromRateCard(rates: {
  inputPerMTok: number
  outputPerMTok: number
  cacheReadRate?: number
  cacheWriteRate?: number
}): BudgetPricer {
  const cacheRead = rates.cacheReadRate ?? 0.1
  const cacheWrite = rates.cacheWriteRate ?? 1.25
  return ({ input, output, cacheRead: cr = 0, cacheWrite: cw = 0 }) => {
    return (
      (input / 1_000_000) * rates.inputPerMTok +
      (output / 1_000_000) * rates.outputPerMTok +
      (cr / 1_000_000) * rates.inputPerMTok * cacheRead +
      (cw / 1_000_000) * rates.inputPerMTok * cacheWrite
    )
  }
}
